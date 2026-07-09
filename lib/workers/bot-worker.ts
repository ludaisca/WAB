import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { sendMessage } from "@/lib/whatsapp";
import { getAIProvider } from "@/lib/ai/factory";
import { searchKnowledge } from "@/lib/ai/rag";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import type { AIProvider } from "@/lib/ai/types";

interface BotMessageJob {
  botId: string;
  waChatId: string;
  incomingMessage: string;
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

  if (!bot || !bot.isActive || bot.status !== "ACTIVE") return;

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

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  messages.push({ role: "system", content: bot.systemPrompt });

  if (bot.ragEnabled) {
    const knowledge = await searchKnowledge(botId, incomingMessage, provider, apiKey);
    if (knowledge) {
      messages.push({
        role: "system",
        content: `Información relevante de la base de conocimiento:\n\n${knowledge}`,
      });
    }
  }

  if (bot.memoryType === "RECENT" && bot.memoryLimit > 0) {
    const history = await prisma.wAMessage.findMany({
      where: { chatId: waChatId },
      orderBy: { timestamp: "desc" },
      take: bot.memoryLimit * 2,
      select: { direction: true, body: true },
    });

    for (const msg of history.reverse()) {
      if (!msg.body) continue;
      messages.push({
        role: msg.direction === "INBOUND" ? "user" : "assistant",
        content: msg.body,
      });
    }
  }

  if (bot.memoryType === "SUMMARY" && conversation.summary) {
    messages.push({
      role: "system",
      content: `Resumen de la conversación anterior:\n${conversation.summary}`,
    });
  }

  messages.push({ role: "user", content: incomingMessage });

  const client = getAIProvider(provider, apiKey);
  const result = await client.complete({
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
  });

  const accessToken = decrypt(bot.waAccount.accessToken);
  const chat = await prisma.wAChat.findUnique({
    where: { id: waChatId },
    select: { remoteJid: true },
  });

  if (!chat) return;

  const sendResult = await sendMessage(bot.waAccount.phoneNumberId, accessToken, {
    to: chat.remoteJid,
    type: "text",
    body: result.content,
  });

  const wamid = sendResult.messages[0]?.id;
  const now = new Date();

  await prisma.wAMessage.create({
    data: {
      wamid,
      chatId: waChatId,
      direction: "OUTBOUND",
      messageType: "text",
      body: result.content,
      status: "sent",
      timestamp: now,
    },
  });

  await prisma.wAChat.update({
    where: { id: waChatId },
    data: {
      lastMessage: result.content.slice(0, 500),
      lastMessageAt: now,
    },
  });

  if (result.usage) {
    const promptTokens = result.usage.promptTokens;
    const completionTokens = result.usage.completionTokens;
    const totalTokens = promptTokens + completionTokens;
    const cost = estimateCost(bot.model, promptTokens, completionTokens);

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
  }

  await prisma.wABotConversation.update({
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
  });

  await prisma.wAAccount.update({
    where: { id: bot.waAccountId },
    data: { lastActivity: now },
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
