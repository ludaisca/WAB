import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { botQueue, mediaDownloadQueue } from "@/lib/queue";
import { autoAssignChat } from "@/lib/whatsapp/auto-assign";

export interface NormalizedInboundMessage {
  remoteJid: string;
  wamid: string | null;
  timestamp: Date;
  type: string;
  body: string;
  contactName: string;
  isGroup: boolean;
  // Meta Cloud media id (resolved later to a downloadable URL).
  mediaId?: string | null;
  // If the channel already produced local bytes (Baileys), the relative path
  // under MEDIA_ROOT is passed here so we skip the async download queue.
  localMediaPath?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  caption?: string | null;
  bytesSize?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface IngestResult {
  messageId: string;
  chatId: string;
}

function phoneFromJid(remoteJid: string): string {
  return remoteJid.split("@")[0];
}

// Meta omits profile.name on some payloads (privacy settings, forwards, template
// replies), in which case the caller falls back to the raw phone number. Treat
// that fallback as "no real name" so a previously-saved name never regresses to
// a bare phone number on a later message.
function isFallbackName(name: string | null | undefined, remoteJid: string): boolean {
  if (!name) return true;
  return name === remoteJid || name === phoneFromJid(remoteJid);
}

// Shared by both the Meta Cloud webhook and the Baileys connection listener
// so the CRM (Contact upsert), chat threading, notifications, and bot
// triggering behave identically regardless of which WhatsApp channel a
// message came in on.
export async function ingestInboundMessage(
  accountId: string,
  msg: NormalizedInboundMessage
): Promise<IngestResult | null> {
  if (msg.wamid) {
    const existing = await prisma.wAMessage.findFirst({
      where: { wamid: msg.wamid },
      select: { id: true },
    });
    if (existing) return null;
  }

  const [existingContact, existingChat] = await Promise.all([
    prisma.contact.findUnique({
      where: { accountId_remoteJid: { accountId, remoteJid: msg.remoteJid } },
      select: { name: true },
    }),
    prisma.wAChat.findUnique({
      where: { accountId_remoteJid: { accountId, remoteJid: msg.remoteJid } },
      select: { name: true },
    }),
  ]);

  const contactNameShouldUpdate =
    !isFallbackName(msg.contactName, msg.remoteJid) || isFallbackName(existingContact?.name, msg.remoteJid);
  const chatNameShouldUpdate =
    !isFallbackName(msg.contactName, msg.remoteJid) || isFallbackName(existingChat?.name, msg.remoteJid);

  const contactRecord = await prisma.contact.upsert({
    where: { accountId_remoteJid: { accountId, remoteJid: msg.remoteJid } },
    create: { accountId, remoteJid: msg.remoteJid, name: msg.contactName },
    update: contactNameShouldUpdate ? { name: msg.contactName } : {},
  });

  const chat = await prisma.wAChat.upsert({
    where: { accountId_remoteJid: { accountId, remoteJid: msg.remoteJid } },
    create: {
      accountId,
      remoteJid: msg.remoteJid,
      name: msg.contactName,
      isGroup: msg.isGroup,
      lastMessage: msg.body.slice(0, 500),
      lastMessageAt: msg.timestamp,
      unreadCount: 1,
      contactId: contactRecord.id,
    },
    update: {
      ...(chatNameShouldUpdate ? { name: msg.contactName } : {}),
      isGroup: msg.isGroup,
      lastMessage: msg.body.slice(0, 500),
      lastMessageAt: msg.timestamp,
      unreadCount: { increment: 1 },
      contactId: contactRecord.id,
    },
  });

  let createdMessage;
  try {
    createdMessage = await prisma.wAMessage.create({
      data: {
        wamid: msg.wamid,
        chatId: chat.id,
        direction: "INBOUND",
        messageType: msg.type,
        body: msg.body,
        caption: msg.caption ?? null,
        mediaId: msg.mediaId ?? null,
        mediaUrl: msg.localMediaPath ?? null,
        mimeType: msg.mimeType ?? null,
        filename: msg.filename ?? null,
        bytesSize: msg.bytesSize ?? null,
        width: msg.width ?? null,
        height: msg.height ?? null,
        duration: msg.duration ?? null,
        timestamp: msg.timestamp,
      },
    });
  } catch (err) {
    // Carrera entre entregas duplicadas del webhook: el findFirst de arriba no
    // vio el duplicado pero el @@unique([chatId, wamid]) sí — tratarlo como el
    // dedupe normal en lugar de reventar con un 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return null;
    }
    throw err;
  }

  // Only Meta needs the async download (Baileys already produced bytes inline).
  if (msg.mediaId && !msg.localMediaPath && msg.type !== "text") {
    await mediaDownloadQueue
      .add("download-media", {
        messageId: createdMessage.id,
        accountId,
        mediaId: msg.mediaId,
      })
      .catch((err) => {
        console.error("[ingest] media-download enqueue failed:", err);
      });
  }

  let assignedToId = chat.assignedToId;
  if (!assignedToId) {
    assignedToId = await autoAssignChat(accountId, chat.id);
  }

  if (assignedToId) {
    await prisma.notification.create({
      data: {
        userId: assignedToId,
        type: "CHAT_MESSAGE",
        title: msg.contactName,
        body: msg.body.slice(0, 200),
        link: `/whatsapp/chat/${accountId}/${chat.id}`,
      },
    });
  }

  await prisma.wAAccount.update({
    where: { id: accountId },
    data: { lastActivity: new Date() },
  });

  const activeBots = await prisma.wABot.findMany({
    where: { waAccountId: accountId, isActive: true, status: "ACTIVE" },
    select: { id: true },
  });

  for (const bot of activeBots) {
    await botQueue.add("process-message", {
      botId: bot.id,
      waChatId: chat.id,
      incomingMessage: msg.body,
      messageId: createdMessage.id,
      messageType: msg.type,
      mediaId: msg.mediaId ?? null,
      localMediaPath: msg.localMediaPath ?? null,
      mimeType: msg.mimeType ?? null,
      caption: msg.caption ?? null,
      filename: msg.filename ?? null,
    });
  }

  return { messageId: createdMessage.id, chatId: chat.id };
}