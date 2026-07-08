import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { sendMessage } from "@/lib/whatsapp";
import { getAIProvider } from "./factory";
import { searchKnowledge } from "./rag";
import { getUserApiKey } from "./settings";
import { estimateCost } from "./pricing";
import type { AIMessage, AIProvider } from "./types";

export async function processBotMessage(
  botId: string,
  waChatId: string,
  incomingMessage: string
) {
  const bot = await prisma.wABot.findUnique({
    where: { id: botId },
    include: { waAccount: true },
  });

  if (!bot || !bot.isActive || bot.status !== "ACTIVE") return null;

  const provider = bot.provider as AIProvider;
  const apiKey = await getUserApiKey(bot.userId, provider);

  if (!apiKey) {
    await prisma.wABot.update({
      where: { id: botId },
      data: { status: "ERROR" },
    });
    return null;
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

  if (!chat) return null;

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

  return { content: result.content, wamid };
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
