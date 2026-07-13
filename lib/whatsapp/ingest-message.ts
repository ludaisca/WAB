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

  const contactRecord = await prisma.contact.upsert({
    where: { accountId_remoteJid: { accountId, remoteJid: msg.remoteJid } },
    create: { accountId, remoteJid: msg.remoteJid, name: msg.contactName },
    update: { name: msg.contactName },
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
      name: msg.contactName,
      isGroup: msg.isGroup,
      lastMessage: msg.body.slice(0, 500),
      lastMessageAt: msg.timestamp,
      unreadCount: { increment: 1 },
      contactId: contactRecord.id,
    },
  });

  const createdMessage = await prisma.wAMessage.create({
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
    });
  }

  return { messageId: createdMessage.id, chatId: chat.id };
}