import { prisma } from "@/lib/prisma";
import { saveMediaFromMeta } from "@/lib/whatsapp/media-store";
import { audioTranscribeQueue } from "@/lib/queue";

interface MediaDownloadJob {
  messageId: string;
  accountId: string;
  mediaId: string;
}

export async function processMediaDownloadJob(job: MediaDownloadJob) {
  const message = await prisma.wAMessage.findUnique({
    where: { id: job.messageId },
    select: {
      id: true,
      mediaUrl: true,
      messageType: true,
      direction: true,
      transcription: true,
      chat: { select: { accountId: true } },
    },
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

  // Notas de voz entrantes → transcripción en segundo plano. Se encola AQUÍ
  // (y no en ingest-message.ts) porque este es el punto donde el archivo ya
  // está en disco — el worker de transcripción nunca ve mediaUrl vacío.
  if (message.messageType === "audio" && message.direction === "INBOUND" && !message.transcription) {
    await audioTranscribeQueue
      .add("transcribe", { messageId: job.messageId })
      .catch((err) => console.error("[media-worker] No se pudo encolar transcripción de audio:", err));
  }
}
