import { prisma } from "@/lib/prisma";
import { saveMediaFromMeta } from "@/lib/whatsapp/media-store";

interface MediaDownloadJob {
  messageId: string;
  accountId: string;
  mediaId: string;
}

export async function processMediaDownloadJob(job: MediaDownloadJob) {
  const message = await prisma.wAMessage.findUnique({
    where: { id: job.messageId },
    select: { id: true, mediaUrl: true, messageType: true, chat: { select: { accountId: true } } },
  });

  if (!message) return;
  if (message.mediaUrl) return; // ya descargado

  const account = await prisma.wAAccount.findUnique({
    where: { id: job.accountId },
    select: { id: true, channel: true, accessToken: true, status: true },
  });
  if (!account) return;
  if (account.channel !== "META_CLOUD" || !account.accessToken) {
    throw new Error("La cuenta no es Meta Cloud o no tiene token");
  }

  const stored = await saveMediaFromMeta(job.accountId, job.mediaId, account.accessToken);

  await prisma.wAMessage.update({
    where: { id: job.messageId },
    data: {
      mediaUrl: stored.relativePath,
      bytesSize: stored.bytesSize,
      mimeType: stored.remoteMimeType,
    },
  });
}