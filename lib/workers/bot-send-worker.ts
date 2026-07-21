import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

interface BotSendJob {
  accountId: string;
  waChatId: string;
  remoteJid: string;
  chunk: string;
}

interface AttemptInfo {
  attemptsMade: number;
  maxAttempts: number;
}

// Delivers one chunk of a "humanized" (split) bot reply — kept in its own queue/worker
// so the delayed sends don't hold a concurrency slot on the bot-messages queue, which
// would otherwise let a single humanized conversation block the other two bot jobs.
export async function processBotSendJob(
  job: BotSendJob,
  attemptInfo: AttemptInfo = { attemptsMade: 0, maxAttempts: 1 }
) {
  try {
    const account = await prisma.wAAccount.findUnique({ where: { id: job.accountId } });
    if (!account) return;

    const sendResult = await sendWhatsAppMessage(account, {
      to: job.remoteJid,
      type: "text",
      body: job.chunk,
    });

    const now = new Date();

    await Promise.all([
      prisma.wAMessage.create({
        data: {
          wamid: sendResult.wamid ?? undefined,
          chatId: job.waChatId,
          direction: "OUTBOUND",
          messageType: "text",
          body: job.chunk,
          status: "sent",
          timestamp: now,
        },
      }),
      prisma.wAChat.update({
        where: { id: job.waChatId },
        data: {
          lastMessage: job.chunk.slice(0, 500),
          lastMessageAt: now,
        },
      }),
    ]);
  } catch (err) {
    const isLastAttempt = attemptInfo.attemptsMade + 1 >= attemptInfo.maxAttempts;
    if (!isLastAttempt) {
      // Deja que BullMQ reintente (attempts/backoff configurados en la cola) —
      // los demás chunks son jobs independientes y no se ven afectados.
      throw err;
    }
    // Sin esto, un chunk que agota sus reintentos desaparece en silencio: el
    // lead recibe la respuesta con un hueco en medio y nadie del equipo se
    // entera (a diferencia del camino no-humanizado, que sí marca ERROR y
    // notifica vía failBotAndNotify en bot-worker.ts).
    console.error("[bot-send-worker] Un chunk agotó sus reintentos sin poder enviarse:", err);
    const bot = await prisma.wABot.findFirst({
      where: { waAccountId: job.accountId, isActive: true, status: "ACTIVE" },
    });
    if (bot) {
      await prisma.notification.create({
        data: {
          userId: bot.userId,
          type: "BOT_ERROR",
          title: `Bot "${bot.name}" — un mensaje no se pudo enviar`,
          body: "Una parte de una respuesta dividida en varios mensajes falló al enviarse tras varios intentos.",
          link: `/whatsapp/chat/${job.accountId}/${job.waChatId}`,
        },
      });
    }
  }
}
