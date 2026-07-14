import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

interface BotSendJob {
  accountId: string;
  waChatId: string;
  remoteJid: string;
  chunk: string;
}

// Delivers one chunk of a "humanized" (split) bot reply — kept in its own queue/worker
// so the delayed sends don't hold a concurrency slot on the bot-messages queue, which
// would otherwise let a single humanized conversation block the other two bot jobs.
export async function processBotSendJob(job: BotSendJob) {
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
}
