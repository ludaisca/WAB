import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getAIProvider } from "@/lib/ai/factory";
import { searchKnowledge } from "@/lib/ai/rag";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { wrapUserPrompt, SCOPE_GUARDRAIL } from "@/lib/ai/prompt-sanitizer";
import { checkBudgetAlert, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";
import { extractDocumentText } from "@/lib/whatsapp/extract-document-text";
import { splitReply, computeTypingDelay } from "@/lib/whatsapp/humanize";
import { botSendQueue } from "@/lib/queue";
import type { AIProvider, AIMessage, ContentPart } from "@/lib/ai/types";

interface BotMessageJob {
  botId: string;
  waChatId: string;
  incomingMessage: string;
  messageId?: string;
  messageType?: string;
  mediaId?: string | null;
  localMediaPath?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  filename?: string | null;
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
      job.waChatId,
      err instanceof Error ? err.message : "Error desconocido"
    );
  }
}

// The lead's message must never go fully unanswered just because the AI call
// failed — after retries are exhausted (or immediately for a non-retryable
// failure like a missing API key), mark the bot ERROR, notify the team, and
// still attempt a graceful hand-off message so the lead gets a reply either way.
async function failBotAndNotify(botId: string, waChatId: string, errorMessage: string) {
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
        link: `/whatsapp/chat/${bot.waAccountId}/${waChatId}`,
      },
    });
  }
  await sendFallbackReply(botId, waChatId);
}

const FALLBACK_REPLY =
  "Gracias por tu mensaje. Estamos teniendo un inconveniente técnico en este momento — un miembro de nuestro equipo te contactará en breve para continuar la conversación.";

async function sendFallbackReply(botId: string, waChatId: string) {
  try {
    const bot = await prisma.wABot.findUnique({ where: { id: botId }, include: { waAccount: true } });
    const chat = await prisma.wAChat.findUnique({ where: { id: waChatId }, select: { remoteJid: true } });
    if (!bot?.waAccount || !chat) return;

    const now = new Date();
    const sendResult = await sendWhatsAppMessage(bot.waAccount, {
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
  const { botId, waChatId, incomingMessage } = job;

  const bot = await prisma.wABot.findUnique({
    where: { id: botId },
    include: { waAccount: true },
  });

  if (!bot || !bot.isActive || bot.status !== "ACTIVE" || !bot.waAccount) return;

  // Mismo gate que lead-scoring y lead-recovery: con el presupuesto mensual ya
  // agotado, el bot deja de responder (sin marcar ERROR — no es una falla del
  // bot) en lugar de seguir gastando sin límite. La notificación BUDGET_EXCEEDED
  // ya avisó al dueño cuando se cruzó el umbral.
  if (await isMonthlyBudgetExceeded(bot.userId, new Date())) {
    console.log(`[bot-worker] Presupuesto mensual de IA superado — el bot "${bot.name}" no responde este mensaje`);
    return;
  }

  const provider = bot.provider as AIProvider;
  const apiKey = await getUserApiKey(bot.userId, provider);

  if (!apiKey) {
    await failBotAndNotify(botId, waChatId, "Configura la clave del proveedor de IA en Configuración.");
    return;
  }

  let conversation = await prisma.wABotConversation.findUnique({
    where: { botId_waChatId: { botId, waChatId } },
  });

  if (!conversation) {
    conversation = await prisma.wABotConversation.create({
      data: { botId, waChatId },
    });
  }

  const messages: AIMessage[] = [];
  messages.push({ role: "system", content: wrapUserPrompt(bot.systemPrompt) });
  messages.push({ role: "system", content: SCOPE_GUARDRAIL });

  if (bot.ragEnabled) {
    const ragQuery =
      job.caption ?? (incomingMessage && incomingMessage !== `[${job.messageType}]` ? incomingMessage : job.messageType ?? "");
    const knowledge = await searchKnowledge(botId, ragQuery, provider, apiKey);
    if (knowledge) {
      messages.push({
        role: "system",
        content: `Información relevante de la base de conocimiento:\n\n${knowledge}`,
      });
    }
  }

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
  if (lastOutbound?.campaign) {
    const exactMessage = lastOutbound.body
      ? `\n\nEl mensaje exacto que recibió el cliente fue:\n"${lastOutbound.body}"`
      : "";
    messages.push({
      role: "system",
      content: `Esta conversación inició a partir de la campaña "${lastOutbound.campaign.name}" usando la plantilla "${lastOutbound.campaign.waTemplate.name}".${exactMessage}\n\nTen este contenido en cuenta al responder — el cliente puede estar reaccionando directamente a este mensaje.`,
    });
  }

  if (bot.memoryType === "RECENT" && bot.memoryLimit > 0) {
    const history = await prisma.wAMessage.findMany({
      // Exclude the message currently being processed — it's already appended below as
      // the final user turn via buildUserContent(); without this it shows up twice
      // (once here from the desc-ordered fetch, once as the "current" turn).
      where: { chatId: waChatId, ...(job.messageId ? { id: { not: job.messageId } } : {}) },
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
    for (const msg of history.reverse()) {
      const textPart = msg.caption ?? msg.body;
      if (!textPart) {
        if (msg.messageType && msg.messageType !== "text") {
          // Pure media without caption — describe it briefly so the bot has context.
          messages.push({
            role: msg.direction === "INBOUND" ? "user" : "assistant",
            content: `[${msg.messageType}]`,
          });
        }
        continue;
      }
      messages.push({
        role: msg.direction === "INBOUND" ? "user" : "assistant",
        content: textPart,
      });
    }
  }

  if (bot.memoryType === "SUMMARY" && conversation.summary) {
    messages.push({
      role: "system",
      content: `Resumen de la conversación anterior:\n${conversation.summary}`,
    });
  }

  // Build the user turn — embed the latest image/audio inline, or the extracted text of a
  // document, if present and the provider/media type combination supports it.
  const userContent = await buildUserContent(job, provider);
  messages.push({ role: "user", content: userContent });

  const client = getAIProvider(provider, apiKey);
  const result = await client.complete({
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
  });

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
    let cumulativeDelay = 0;
    for (const chunk of chunks) {
      cumulativeDelay += computeTypingDelay(chunk);
      await botSendQueue.add(
        "send-chunk",
        { accountId: bot.waAccount.id, waChatId, remoteJid: chat.remoteJid, chunk },
        { delay: cumulativeDelay }
      );
    }
  } else {
    const sendResult = await sendWhatsAppMessage(bot.waAccount, {
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
    prisma.wABotConversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 1 },
        lastInteraction: now,
        ...(bot.memoryType === "SUMMARY"
          ? {
              // El resumen debe acumular AMBOS lados del turno — solo con las
              // respuestas del bot, la "memoria" olvidaba todo lo que el
              // cliente dijo.
              summary: summarizeText(
                `Cliente: ${job.caption ?? incomingMessage}\nAsistente: ${result.content}`,
                conversation.summary
              ),
            }
          : {}),
      },
    }),
    prisma.wAAccount.update({
      where: { id: bot.waAccount.id },
      data: { lastActivity: now },
    }),
    (async () => {
      if (!result.usage) return;
      const promptTokens = result.usage.promptTokens;
      const completionTokens = result.usage.completionTokens;
      const totalTokens = promptTokens + completionTokens;
      const cost = await estimateCost(bot.model, promptTokens, completionTokens, provider);

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

async function buildUserContent(job: BotMessageJob, provider: AIProvider): Promise<string | ContentPart[]> {
  const isImage = job.messageType === "image" || job.messageType === "sticker";
  // Audio understanding only works through Gemini's native inlineData — OpenRouter
  // has no generic audio content shape (see ContentPart["audio_url"] comment).
  const isAudio = job.messageType === "audio" && provider === "google";
  const isDocument = job.messageType === "document";
  const bodyText = job.caption ?? job.incomingMessage ?? "";
  const fallbackLabel = `[${job.messageType === "audio" ? "audio" : job.messageType} recibido]`;

  if (!isImage && !isAudio && !isDocument) {
    return bodyText || `[${job.messageType ?? "text"}]`;
  }

  let localPath = job.localMediaPath ?? null;
  let mimeType = job.mimeType ?? null;

  // The Meta download worker may not have finished yet — re-check DB.
  if (!localPath && job.messageId) {
    const latest = await prisma.wAMessage.findUnique({
      where: { id: job.messageId },
      select: { mediaUrl: true, mimeType: true },
    }).catch(() => null);
    if (latest?.mediaUrl) localPath = latest.mediaUrl;
    if (latest?.mimeType) mimeType = latest.mimeType;
  }

  if (!localPath) {
    return bodyText && bodyText !== `[${job.messageType}]` ? `${fallbackLabel} ${bodyText}` : fallbackLabel;
  }
  const absolute = resolveAbsolutePath(localPath);

  if (isDocument) {
    const extracted = await extractDocumentText(absolute, mimeType);
    if (!extracted) {
      return bodyText && bodyText !== `[document]` ? `${fallbackLabel} ${bodyText}` : fallbackLabel;
    }
    const label = job.filename ? `Documento "${job.filename}"` : "Documento recibido";
    const caption = bodyText && bodyText !== `[document]` ? `\nMensaje del prospecto: ${bodyText}` : "";
    return `${label}, contenido extraído:\n\n${extracted}${caption}`;
  }

  try {
    const buffer = await fs.readFile(absolute);
    const base64 = buffer.toString("base64");
    const mime = mimeType ?? (isImage ? "image/jpeg" : "audio/ogg");

    const parts: ContentPart[] = [];
    if (bodyText && bodyText !== `[${job.messageType}]`) {
      parts.push({ type: "text", text: bodyText });
    }
    parts.push(
      isImage
        ? { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }
        : { type: "audio_url", audio_url: { url: `data:${mime};base64,${base64}` } }
    );
    return parts;
  } catch (err) {
    console.error(`[bot-worker] No se pudo leer el ${isImage ? "imagen" : "audio"} local:`, err);
    return bodyText || fallbackLabel;
  }
}


function summarizeText(newMessage: string, existingSummary: string | null): string {
  const combined = existingSummary
    ? `${existingSummary}\n\n---\n\n${newMessage}`
    : newMessage;

  if (combined.length > 2000) {
    return combined.slice(combined.length - 2000);
  }

  return combined;
}
