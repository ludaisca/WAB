import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { checkBudgetAlert, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";
import { extractDocumentText } from "@/lib/whatsapp/extract-document-text";
import { splitReply, computeTypingDelay } from "@/lib/whatsapp/humanize";
import { summarizeText } from "@/lib/ai/summarize";
import { botSendQueue } from "@/lib/queue";
import { generateBotReply } from "@/lib/whatsapp/bot-tools/generate-reply";
import type { AIMessage, ContentPart } from "@/lib/ai/types";

interface BotMessageJob {
  botId: string;
  // La cuenta de WhatsApp específica de este mensaje entrante — un bot puede
  // estar vinculado a varias cuentas (WABotAccount), así que ya no se puede
  // derivar "la" cuenta del bot; ingestInboundMessage() la conoce en el
  // momento de encolar y la manda explícita.
  accountId: string;
  waChatId: string;
}

// El turno que el bot va a responder no es "el mensaje que disparó el job" —
// ingestInboundMessage() encola este job con un delay (debounce, ver
// BOT_DEBOUNCE_MS) y deduplicado por lock de Redis, así que para cuando
// realmente corre puede haber varios mensajes nuevos del lead acumulados.
// Se relee todo lo INBOUND posterior al último OUTBOUND del chat — eso cubre
// tanto la ráfaga que originó el job como cualquier otro mensaje que haya
// entrado durante la ventana de espera.
interface PendingMessage {
  id: string;
  messageType: string;
  body: string | null;
  caption: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  filename: string | null;
}

async function getPendingInboundMessages(waChatId: string): Promise<PendingMessage[]> {
  const lastOutbound = await prisma.wAMessage.findFirst({
    where: { chatId: waChatId, direction: "OUTBOUND" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  return prisma.wAMessage.findMany({
    where: {
      chatId: waChatId,
      direction: "INBOUND",
      ...(lastOutbound ? { timestamp: { gt: lastOutbound.timestamp } } : {}),
    },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      messageType: true,
      body: true,
      caption: true,
      mediaId: true,
      mediaUrl: true,
      mimeType: true,
      filename: true,
    },
  });
}

// Texto plano de todos los mensajes pendientes, unidos — así "hola" + "quiero
// cotizar una mesa quirúrgica" llegan al modelo como un solo turno coherente
// en vez de dos turnos "user" consecutivos sin respuesta entre ellos.
function combinedPendingText(pending: PendingMessage[]): string {
  return pending
    .map((m) => m.caption ?? m.body)
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join("\n");
}

interface AttemptInfo {
  attemptsMade: number;
  maxAttempts: number;
}

export async function processBotMessageJob(
  job: BotMessageJob,
  attemptInfo: AttemptInfo = { attemptsMade: 0, maxAttempts: 1 }
) {
  try {
    await handleBotMessage(job);
  } catch (err) {
    console.error("[bot-worker] Error processing job:", err instanceof Error ? err.message : err);
    const isLastAttempt = attemptInfo.attemptsMade + 1 >= attemptInfo.maxAttempts;
    if (!isLastAttempt) {
      // Rethrow so BullMQ's configured retries (attempts: 3, exponential backoff)
      // actually kick in — a transient network blip shouldn't give up on the
      // first try and leave the lead's message unanswered.
      throw err;
    }
    await failBotAndNotify(
      job.botId,
      job.accountId,
      job.waChatId,
      err instanceof Error ? err.message : "Error desconocido"
    );
  }
}

// The lead's message must never go fully unanswered just because the AI call
// failed — after retries are exhausted (or immediately for a non-retryable
// failure like a missing API key), mark the bot ERROR, notify the team, and
// still attempt a graceful hand-off message so the lead gets a reply either way.
async function failBotAndNotify(botId: string, accountId: string, waChatId: string, errorMessage: string) {
  const bot = await prisma.wABot
    .update({ where: { id: botId }, data: { status: "ERROR" } })
    .catch(() => null);
  if (bot) {
    await prisma.notification.create({
      data: {
        userId: bot.userId,
        type: "BOT_ERROR",
        title: `Bot "${bot.name}" con error`,
        body: errorMessage.slice(0, 200),
        link: `/whatsapp/chat/${accountId}/${waChatId}`,
      },
    });
  }
  await sendFallbackReply(botId, accountId, waChatId);
}

const FALLBACK_REPLY =
  "Gracias por tu mensaje. Estamos teniendo un inconveniente técnico en este momento — un miembro de nuestro equipo te contactará en breve para continuar la conversación.";

async function sendFallbackReply(botId: string, accountId: string, waChatId: string) {
  try {
    const bot = await prisma.wABot.findUnique({ where: { id: botId } });
    const account = await prisma.wAAccount.findUnique({ where: { id: accountId } });
    const chat = await prisma.wAChat.findUnique({ where: { id: waChatId }, select: { remoteJid: true } });
    if (!bot || !account || !chat) return;

    const now = new Date();
    const sendResult = await sendWhatsAppMessage(account, {
      to: chat.remoteJid,
      type: "text",
      body: FALLBACK_REPLY,
    });

    await Promise.all([
      prisma.wAMessage.create({
        data: {
          wamid: sendResult.wamid ?? undefined,
          chatId: waChatId,
          direction: "OUTBOUND",
          messageType: "text",
          body: FALLBACK_REPLY,
          status: "sent",
          timestamp: now,
        },
      }),
      prisma.wAChat.update({
        where: { id: waChatId },
        data: { lastMessage: FALLBACK_REPLY.slice(0, 500), lastMessageAt: now },
      }),
    ]);
  } catch (err) {
    // Best-effort — if even the fallback send fails (e.g. WhatsApp's API is down
    // too), there's nothing more automatic left to try; the BOT_ERROR notification
    // already created is what surfaces this to a human.
    console.error("[bot-worker] No se pudo enviar el mensaje de respaldo:", err instanceof Error ? err.message : err);
  }
}

async function handleBotMessage(job: BotMessageJob) {
  const { botId, accountId, waChatId } = job;

  const bot = await prisma.wABot.findUnique({ where: { id: botId } });
  // La cuenta se resuelve por el accountId del mensaje entrante, no por el bot
  // — un bot puede estar vinculado a varias cuentas (WABotAccount) a la vez.
  const account = await prisma.wAAccount.findUnique({ where: { id: accountId } });

  if (!bot || !bot.isActive || bot.status !== "ACTIVE" || !account) return;

  // Segunda línea de defensa de la lista negra (la primera está en
  // ingest-message.ts): si el contacto fue bloqueado entre el enqueue y la
  // ejecución del job, el bot no responde. Los mensajes de prueba
  // (test/conversations) ignoran esto deliberadamente — probar no es enviar.
  const blockedChat = await prisma.wAChat.findUnique({
    where: { id: waChatId },
    select: { contact: { select: { blockedAt: true } } },
  });
  if (blockedChat?.contact?.blockedAt) return;

  const pendingMessages = await getPendingInboundMessages(waChatId);
  // Nada pendiente que responder — ej. un humano ya contestó manualmente
  // durante la ventana de debounce. No es un error, simplemente no hay nada
  // que hacer (evita una respuesta redundante del bot encima de la humana).
  if (pendingMessages.length === 0) return;
  const pendingIds = pendingMessages.map((m) => m.id);
  const incomingMessage = combinedPendingText(pendingMessages);

  // Mismo gate que lead-scoring y lead-recovery: con el presupuesto mensual ya
  // agotado, el bot deja de responder (sin marcar ERROR — no es una falla del
  // bot) en lugar de seguir gastando sin límite. La notificación BUDGET_EXCEEDED
  // ya avisó al dueño cuando se cruzó el umbral.
  if (await isMonthlyBudgetExceeded(bot.userId, new Date())) {
    console.log(`[bot-worker] Presupuesto mensual de IA superado — el bot "${bot.name}" no responde este mensaje`);
    return;
  }

  const apiKey = await getUserApiKey(bot.userId);

  if (!apiKey) {
    await failBotAndNotify(botId, accountId, waChatId, "Configura la clave de Google IA en Configuración.");
    return;
  }

  // upsert en vez de findUnique+create: dos mensajes seguidos del mismo lead
  // (doble-texteo) pueden disparar dos jobs bot-messages en paralelo
  // (concurrencia 3) que compitan por crear la misma fila — con create()
  // suelto, el perdedor lanzaba una violación de @@unique([botId, waChatId])
  // antes de siquiera llamar a la IA.
  const conversation = await prisma.wABotConversation.upsert({
    where: { botId_waChatId: { botId, waChatId } },
    create: { botId, waChatId },
    update: {},
  });

  // Regardless of memoryType, if the most recent outbound message in this chat came
  // from a campaign send, tell the bot what the customer is replying to — otherwise
  // it replies "blind" to a lead who just received a specific marketing offer.
  const lastOutbound = await prisma.wAMessage.findFirst({
    where: { chatId: waChatId, direction: "OUTBOUND" },
    orderBy: { timestamp: "desc" },
    select: {
      body: true,
      campaign: { select: { name: true, waTemplate: { select: { name: true } } } },
    },
  });

  const extraSystemNotes: string[] = [];
  if (lastOutbound?.campaign) {
    const exactMessage = lastOutbound.body
      ? `\n\nEl mensaje exacto que recibió el cliente fue:\n"${lastOutbound.body}"`
      : "";
    extraSystemNotes.push(
      `Esta conversación inició a partir de la campaña "${lastOutbound.campaign.name}" usando la plantilla "${lastOutbound.campaign.waTemplate.name}".${exactMessage}\n\nTen este contenido en cuenta al responder — el cliente puede estar reaccionando directamente a este mensaje.`
    );
  }

  const history: AIMessage[] = [];
  if (bot.memoryType === "RECENT" && bot.memoryLimit > 0) {
    const pastMessages = await prisma.wAMessage.findMany({
      // Exclude every mensaje pendiente que se está procesando ahora — ya se
      // agregan abajo como el turno "current" vía buildUserContent(); sin
      // esto aparecerían dos veces (aquí y como el turno actual).
      where: { chatId: waChatId, id: { notIn: pendingIds } },
      orderBy: { timestamp: "desc" },
      take: bot.memoryLimit * 2,
      select: {
        direction: true,
        body: true,
        messageType: true,
        mimeType: true,
        mediaUrl: true,
        caption: true,
      },
    });

    // Reverse to chronological order; build user/assistant turns preserving plain text
    // (historical images are NOT forwarded to keep token cost bounded).
    for (const msg of pastMessages.reverse()) {
      const textPart = msg.caption ?? msg.body;
      if (!textPart) {
        if (msg.messageType && msg.messageType !== "text") {
          // Pure media without caption — describe it briefly so the bot has context.
          history.push({
            role: msg.direction === "INBOUND" ? "user" : "assistant",
            content: `[${msg.messageType}]`,
          });
        }
        continue;
      }
      history.push({
        role: msg.direction === "INBOUND" ? "user" : "assistant",
        content: textPart,
      });
    }
  }

  if (bot.memoryType === "SUMMARY" && conversation.summary) {
    extraSystemNotes.push(`Resumen de la conversación anterior:\n${conversation.summary}`);
  }

  // Build the user turn — embed the latest image/audio inline, or the extracted text of a
  // document, if present and the media type combination supports it.
  const userContent = await buildUserContent(pendingMessages);

  const ragQuery = incomingMessage || pendingMessages[pendingMessages.length - 1]?.messageType || "";

  const replyResult = await generateBotReply({
    bot,
    apiKey,
    ragQuery,
    extraSystemNotes,
    history,
    userContent,
    qualifiedData: (conversation.qualifiedData as Record<string, string> | null) ?? undefined,
  });
  const result = { content: replyResult.content, usage: replyResult.usage ?? undefined };

  const chat = await prisma.wAChat.findUnique({
    where: { id: waChatId },
    select: { remoteJid: true },
  });

  if (!chat) return;

  const now = new Date();

  if (bot.humanizeEnabled) {
    // Split the reply across several messages with a simulated typing delay between
    // each, queued as separate delayed jobs so this job returns immediately instead
    // of holding a bot-messages concurrency slot for the whole send sequence.
    const chunks = splitReply(result.content);
    if (chunks.length === 0) {
      // Mirrors the non-humanized path, where an empty body gets rejected by
      // Meta and throws — without this the lead silently never gets a reply.
      // Throwing here reuses processBotMessageJob's existing retry + fallback
      // + BOT_ERROR notification path instead of duplicating it.
      throw new Error("La IA devolvió una respuesta vacía");
    }
    let cumulativeDelay = 0;
    try {
      for (const chunk of chunks) {
        cumulativeDelay += computeTypingDelay(chunk);
        await botSendQueue.add(
          "send-chunk",
          { accountId, waChatId, remoteJid: chat.remoteJid, chunk },
          { delay: cumulativeDelay }
        );
      }
    } catch (err) {
      // No relanzar: processBotMessageJob reintentaría todo el job, lo que
      // volvería a llamar a la IA y re-encolaría los chunks desde cero,
      // duplicando los que ya alcanzaron a agendarse antes de este fallo.
      console.error("[bot-worker] No se pudieron encolar todos los chunks humanizados:", err);
      await prisma.notification.create({
        data: {
          userId: bot.userId,
          type: "BOT_ERROR",
          title: `Bot "${bot.name}" — envío incompleto`,
          body: "Una respuesta dividida en varios mensajes no se terminó de encolar — revisa la conexión con Redis.",
          link: `/whatsapp/chat/${accountId}/${waChatId}`,
        },
      });
    }
  } else {
    const sendResult = await sendWhatsAppMessage(account, {
      to: chat.remoteJid,
      type: "text",
      body: result.content,
    });

    await Promise.all([
      prisma.wAMessage.create({
        data: {
          wamid: sendResult.wamid ?? undefined,
          chatId: waChatId,
          direction: "OUTBOUND",
          messageType: "text",
          body: result.content,
          status: "sent",
          timestamp: now,
        },
      }),
      prisma.wAChat.update({
        where: { id: waChatId },
        data: {
          lastMessage: result.content.slice(0, 500),
          lastMessageAt: now,
        },
      }),
    ]);
  }

  await Promise.all([
    // qualifiedData se persiste siempre (independiente de memoryType) — el
    // sondeo del prospecto no depende de qué tipo de memoria de historial usa
    // el bot. summary solo se actualiza si el bot usa memoria SUMMARY.
    prisma.wABotConversation.update({
      where: { id: conversation.id },
      data: {
        qualifiedData: replyResult.qualifiedData,
        ...(bot.memoryType === "SUMMARY"
          ? {
              // El resumen debe acumular AMBOS lados del turno — solo con las
              // respuestas del bot, la "memoria" olvidaba todo lo que el
              // cliente dijo.
              summary: summarizeText(
                `Cliente: ${incomingMessage}\nAsistente: ${result.content}`,
                conversation.summary
              ),
            }
          : {}),
      },
    }),
    prisma.wAAccount.update({
      where: { id: accountId },
      data: { lastActivity: now },
    }),
    (async () => {
      if (!result.usage) return;
      const promptTokens = result.usage.promptTokens;
      const completionTokens = result.usage.completionTokens;
      const totalTokens = promptTokens + completionTokens;
      const cost = await estimateCost(bot.model, promptTokens, completionTokens);

      await prisma.wABotUsage.create({
        data: {
          botId,
          waChatId,
          model: bot.model,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost: cost,
        },
      });

      await checkBudgetAlert(bot.userId, now);
    })(),
  ]);
}

// Un burst puede traer varios mensajes pendientes; a lo más UNO se procesa
// como contenido multimodal (el más reciente con media soportada) — mandar
// varias imágenes/audios en un solo turno no está soportado hoy y encarece
// el turno sin necesidad real. El texto de TODOS los pendientes (incluidas
// captions de mensajes con media anteriores) sí se combina siempre.
async function buildUserContent(pending: PendingMessage[]): Promise<string | ContentPart[]> {
  const textBlock = combinedPendingText(pending);
  const mediaMsg = [...pending].reverse().find(
    (m) =>
      m.messageType === "image" ||
      m.messageType === "sticker" ||
      m.messageType === "document" ||
      // Audio understanding only works through Gemini's native inlineData
      // (see ContentPart["audio_url"]).
      m.messageType === "audio"
  );

  if (!mediaMsg) {
    return textBlock || `[${pending[pending.length - 1]?.messageType ?? "text"}]`;
  }

  const isImage = mediaMsg.messageType === "image" || mediaMsg.messageType === "sticker";
  const isAudio = mediaMsg.messageType === "audio";
  const isDocument = mediaMsg.messageType === "document";
  const fallbackLabel = `[${isAudio ? "audio" : mediaMsg.messageType} recibido]`;

  let localPath = mediaMsg.mediaUrl;
  let mimeType = mediaMsg.mimeType;

  // The Meta download worker may not have finished yet — re-check DB.
  if (!localPath) {
    const latest = await prisma.wAMessage.findUnique({
      where: { id: mediaMsg.id },
      select: { mediaUrl: true, mimeType: true },
    }).catch(() => null);
    if (latest?.mediaUrl) localPath = latest.mediaUrl;
    if (latest?.mimeType) mimeType = latest.mimeType;
  }

  if (!localPath) {
    return textBlock ? `${fallbackLabel} ${textBlock}` : fallbackLabel;
  }
  const absolute = resolveAbsolutePath(localPath);

  if (isDocument) {
    const extracted = await extractDocumentText(absolute, mimeType);
    if (!extracted) {
      return textBlock ? `${fallbackLabel} ${textBlock}` : fallbackLabel;
    }
    const label = mediaMsg.filename ? `Documento "${mediaMsg.filename}"` : "Documento recibido";
    const caption = textBlock ? `\nMensaje del prospecto: ${textBlock}` : "";
    return `${label}, contenido extraído:\n\n${extracted}${caption}`;
  }

  try {
    const buffer = await fs.readFile(absolute);
    const base64 = buffer.toString("base64");
    const mime = mimeType ?? (isImage ? "image/jpeg" : "audio/ogg");

    const parts: ContentPart[] = [];
    if (textBlock) {
      parts.push({ type: "text", text: textBlock });
    }
    parts.push(
      isImage
        ? { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }
        : { type: "audio_url", audio_url: { url: `data:${mime};base64,${base64}` } }
    );
    return parts;
  } catch (err) {
    console.error(`[bot-worker] No se pudo leer el ${isImage ? "imagen" : "audio"} local:`, err);
    return textBlock || fallbackLabel;
  }
}
