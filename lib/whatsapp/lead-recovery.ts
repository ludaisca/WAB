import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { wrapUserPrompt, SCOPE_GUARDRAIL } from "@/lib/ai/prompt-sanitizer";
import type { AIProvider, AIMessage } from "@/lib/ai/types";
import type { WABot, WAAccount } from "@prisma/client";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 12;

// Meta's 24h customer-service window closes based on the LEAD's last inbound
// message, not our last outbound — this is checked live, right before every
// send, as a safety net. With the current default thresholds (2h/12h) this
// should never actually trip, but if the config is ever loosened past 24h,
// this is what stops a free-text send from violating Meta's policy instead
// of silently failing at Meta's end.
function isWithinServiceWindow(lastInboundAt: Date, now: Date): boolean {
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

function localHourInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return hour % 24;
}

export function isWithinBusinessHours(
  now: Date,
  { timezone, startHour, endHour }: { timezone: string; startHour: number; endHour: number }
): boolean {
  const hour = localHourInTz(now, timezone);
  return hour >= startHour && hour < endHour;
}

// Framed as a "user" turn (not "system") on purpose: the history above ends
// on an "assistant" turn (our own last real message), and a chat-tuned model
// expects to keep alternating — closing on another system aside with no
// fresh user turn left the model without a clear "your turn to speak now"
// signal, and it drifted into writing the NEXT customer line instead of its
// own reply (confirmed live: it literally wrote in the lead's voice). This is
// explicitly labeled as an internal instruction, not something the customer
// said, so the model doesn't mistake it for real customer input either.
const ATTEMPT_INSTRUCTION: Record<1 | 2, string> = {
  1: "(Instrucción interna del sistema, no es un mensaje del cliente) El cliente dejó de responder hace un rato. Escribe TÚ, como el agente, un mensaje breve, natural y cordial para retomar la conversación justo donde se quedó — refiérete a algo concreto de lo que ya se habló, sin sonar a plantilla de marketing ni repetir literalmente tu último mensaje. Responde solo con el texto del mensaje a enviar, nada más.",
  2: "(Instrucción interna del sistema, no es un mensaje del cliente) El cliente sigue sin responder después de un primer mensaje de seguimiento. Escribe TÚ, como el agente, un segundo mensaje breve, un poco más directo pero siempre cordial — dale una razón concreta o una pregunta fácil de contestar para retomar el contacto. No repitas el mensaje anterior ni suenes insistente. Responde solo con el texto del mensaje a enviar, nada más.",
};

interface RecoveryChat {
  id: string;
  remoteJid: string;
}

type RecoveryBot = WABot & { waAccount: WAAccount | null };

// Generates (via the same bot that already talks to this lead) and sends a
// reactivation message, then logs it as a WAMessage + WALeadRecoveryAttempt.
// Throws on failure — the caller (the tick worker) catches per-chat so one
// bad send doesn't abort the whole batch.
export async function sendRecoveryMessage(
  chat: RecoveryChat,
  bot: RecoveryBot,
  attemptNumber: 1 | 2,
  lastInboundAt: Date,
  now: Date
): Promise<void> {
  if (!isWithinServiceWindow(lastInboundAt, now)) {
    throw new Error(
      `Ventana de 24h de Meta ya cerrada para el chat ${chat.id} — se omite el mensaje de reactivación (no hay plantilla configurada todavía)`
    );
  }

  const waAccount = bot.waAccount;
  if (!waAccount) {
    throw new Error(`Bot "${bot.name}" no tiene una cuenta de WhatsApp asociada`);
  }

  const provider = bot.provider as AIProvider;
  const apiKey = await getUserApiKey(bot.userId, provider);
  if (!apiKey) {
    throw new Error(`Bot "${bot.name}" sin API key configurada — no se puede generar el mensaje de reactivación`);
  }

  const history = await prisma.wAMessage.findMany({
    where: { chatId: chat.id },
    orderBy: { timestamp: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true, caption: true, messageType: true },
  });

  const messages: AIMessage[] = [
    { role: "system", content: wrapUserPrompt(bot.systemPrompt) },
    { role: "system", content: SCOPE_GUARDRAIL },
  ];

  for (const msg of history.reverse()) {
    const text = msg.caption ?? msg.body;
    if (!text) continue;
    messages.push({ role: msg.direction === "INBOUND" ? "user" : "assistant", content: text });
  }

  messages.push({ role: "user", content: ATTEMPT_INSTRUCTION[attemptNumber] });

  const client = getAIProvider(provider, apiKey);
  const result = await client.complete({
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
  });

  const sendResult = await sendWhatsAppMessage(waAccount, {
    to: chat.remoteJid,
    type: "text",
    body: result.content,
  });

  const message = await prisma.wAMessage.create({
    data: {
      wamid: sendResult.wamid ?? undefined,
      chatId: chat.id,
      direction: "OUTBOUND",
      messageType: "text",
      body: result.content,
      status: "sent",
      timestamp: now,
    },
  });

  await prisma.wAChat.update({
    where: { id: chat.id },
    data: { lastMessage: result.content.slice(0, 500), lastMessageAt: now },
  });

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  const cost = result.usage
    ? await estimateCost(bot.model, promptTokens, completionTokens, provider)
    : 0;

  await prisma.wALeadRecoveryAttempt.create({
    data: {
      chatId: chat.id,
      attemptNumber,
      messageId: message.id,
      model: bot.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: cost,
    },
  });
}
