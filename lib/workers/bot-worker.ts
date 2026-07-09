import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
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

  const chat = await prisma.wAChat.findUnique({
    where: { id: waChatId },
    select: { remoteJid: true },
  });

  if (!chat) return;

  const sendResult = await sendWhatsAppMessage(bot.waAccount, {
    to: chat.remoteJid,
    type: "text",
    body: result.content,
  });

  const wamid = sendResult.wamid ?? undefined;
  const now = new Date();

  await Promise.all([
    prisma.wAMessage.create({
      data: {
        wamid,
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
      where: { id: bot.waAccountId },
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
