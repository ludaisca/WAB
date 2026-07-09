import { prisma } from "@/lib/prisma";
import { botQueue } from "@/lib/queue";

export interface NormalizedInboundMessage {
  remoteJid: string;
  wamid: string | null;
  timestamp: Date;
  type: string;
  body: string;
  contactName: string;
  isGroup: boolean;
  mediaId?: string | null;
  mimeType?: string | null;
}

// Shared by both the Meta Cloud webhook and the Baileys connection listener
// so the CRM (Contact upsert), chat threading, notifications, and bot
// triggering behave identically regardless of which WhatsApp channel a
// message came in on.
export async function ingestInboundMessage(accountId: string, msg: NormalizedInboundMessage) {
  if (msg.wamid) {
    const existing = await prisma.wAMessage.findFirst({
      where: { wamid: msg.wamid },
      select: { id: true },
    });
    if (existing) return;
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

  await prisma.wAMessage.create({
    data: {
      wamid: msg.wamid,
      chatId: chat.id,
      direction: "INBOUND",
      messageType: msg.type,
      body: msg.body,
      mediaId: msg.mediaId ?? null,
      mimeType: msg.mimeType ?? null,
      timestamp: msg.timestamp,
    },
  });

  if (chat.assignedToId) {
    await prisma.notification.create({
      data: {
        userId: chat.assignedToId,
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
    });
  }
}
