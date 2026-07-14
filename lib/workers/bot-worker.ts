import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getAIProvider } from "@/lib/ai/factory";
import { searchKnowledge } from "@/lib/ai/rag";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { wrapUserPrompt } from "@/lib/ai/prompt-sanitizer";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";
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
}

export async function processBotMessageJob(job: BotMessageJob) {
  try {
    await handleBotMessage(job);
  } catch (err) {
    console.error("[bot-worker] Error processing job:", err instanceof Error ? err.message : err);
    const bot = await prisma.wABot
      .update({ where: { id: job.botId }, data: { status: "ERROR" } })
      .catch(() => null);
    if (bot) {
      await prisma.notification.create({
        data: {
          userId: bot.userId,
          type: "BOT_ERROR",
          title: `Bot "${bot.name}" con error`,
          body: err instanceof Error ? err.message.slice(0, 200) : "Error desconocido",
          link: `/whatsapp/bots/${bot.id}`,
        },
      });
    }
  }
}

async function handleBotMessage(job: BotMessageJob) {
  const { botId, waChatId, incomingMessage } = job;

  const bot = await prisma.wABot.findUnique({
    where: { id: botId },
    include: { waAccount: true },
  });

  if (!bot || !bot.isActive || bot.status !== "ACTIVE" || !bot.waAccount) return;

  const provider = bot.provider as AIProvider;
  const apiKey = await getUserApiKey(bot.userId, provider);

  if (!apiKey) {
    await prisma.wABot.update({
      where: { id: botId },
      data: { status: "ERROR" },
    });
    await prisma.notification.create({
      data: {
        userId: bot.userId,
        type: "BOT_ERROR",
        title: `Bot "${bot.name}" sin API key`,
        body: "Configura la clave del proveedor de IA en Configuración.",
        link: `/whatsapp/bots/${botId}`,
      },
    });
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
      campaign: { select: { name: true, waTemplate: { select: { name: true } } } },
    },
  });
  if (lastOutbound?.campaign) {
    messages.push({
      role: "system",
      content: `Esta conversación inició a partir de la campaña "${lastOutbound.campaign.name}" usando la plantilla "${lastOutbound.campaign.waTemplate.name}". Ten esto en cuenta al responder.`,
    });
  }

  if (bot.memoryType === "RECENT" && bot.memoryLimit > 0) {
    const history = await prisma.wAMessage.findMany({
      where: { chatId: waChatId },
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
      if (!textPart) continue;
      if (msg.messageType && msg.messageType !== "text" && !textPart) {
        // Pure legacy media without caption — describe it briefly so the bot has context.
        messages.push({
          role: msg.direction === "INBOUND" ? "user" : "assistant",
          content: `[${msg.messageType}]`,
        });
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

  // Build the user turn — embed the latest image inline if present and the model supports vision.
  const userContent = await buildUserContent(job);
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
              summary: summarizeText(result.content, conversation.summary),
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

async function buildUserContent(job: BotMessageJob): Promise<string | ContentPart[]> {
  const isImage = job.messageType === "image" || job.messageType === "sticker";
  const bodyText = job.caption ?? job.incomingMessage ?? "";

  if (!isImage) {
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
    return bodyText && bodyText !== `[image]` ? `[imagen recibida] ${bodyText}` : `[imagen recibida]`;
  }

  try {
    const absolute = resolveAbsolutePath(localPath);
    const buffer = await fs.readFile(absolute);
    const base64 = buffer.toString("base64");
    const mime = mimeType ?? "image/jpeg";

    const parts: ContentPart[] = [];
    if (bodyText && bodyText !== `[${job.messageType}]`) {
      parts.push({ type: "text", text: bodyText });
    }
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${base64}` },
    });
    return parts;
  } catch (err) {
    console.error("[bot-worker] No se pudo leer la imagen local:", err);
    return bodyText || `[imagen recibida]`;
  }
}

async function checkBudgetAlert(userId: string, now: Date) {
  const settings = await prisma.appSettings.findUnique({ where: { userId } });
  if (!settings?.monthlyBudgetUsd) return;

  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (settings.budgetAlertMonth === monthKey) return;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyUsage = await prisma.wABotUsage.aggregate({
    where: { bot: { userId }, createdAt: { gte: monthStart } },
    _sum: { estimatedCost: true },
  });
  const monthlyCost = monthlyUsage._sum.estimatedCost ?? 0;

  if (monthlyCost < settings.monthlyBudgetUsd) return;

  await prisma.appSettings.update({
    where: { userId },
    data: { budgetAlertMonth: monthKey },
  });

  await prisma.notification.create({
    data: {
      userId,
      type: "BUDGET_EXCEEDED",
      title: "Presupuesto mensual de IA superado",
      body: `Costo estimado este mes: $${monthlyCost.toFixed(2)} (límite: $${settings.monthlyBudgetUsd.toFixed(2)})`,
      link: "/configuracion/ia",
    },
  });
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
