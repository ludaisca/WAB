import { NextResponse } from "next/server";
import { createHmac, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { botQueue } from "@/lib/queue";

interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; caption?: string; filename?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { payload: string; text: string };
}

interface WebhookStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
}

function getMessageBody(msg: WebhookMessage): string {
  if (msg.text) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.caption) return msg.document.caption;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  if (msg.button) return msg.button.text;
  return `[${msg.type}]`;
}

function getMediaInfo(msg: WebhookMessage): {
  mediaId: string | null;
  mimeType: string | null;
} {
  if (msg.image) return { mediaId: msg.image.id, mimeType: msg.image.mime_type ?? null };
  if (msg.video) return { mediaId: msg.video.id, mimeType: msg.video.mime_type ?? null };
  if (msg.audio) return { mediaId: msg.audio.id, mimeType: msg.audio.mime_type ?? null };
  if (msg.document) return { mediaId: msg.document.id, mimeType: msg.document.mime_type ?? null };
  return { mediaId: null, mimeType: null };
}

function extractPhoneNumberId(body: unknown): string | null {
  try {
    const obj = body as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }> };
    return obj.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  } catch {
    return null;
  }
}

async function validateSignature(
  body: string,
  signature: string | null,
  phoneNumberId: string
): Promise<boolean> {
  if (!signature) return false;

  const account = await prisma.wAAccount.findFirst({
    where: { phoneNumberId },
    select: { appSecret: true },
  });

  if (!account?.appSecret) return true;

  try {
    const { decrypt } = await import("@/lib/crypto");
    const secret = decrypt(account.appSecret);
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const received = signature.replace("sha256=", "");
    return expected === received;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const hash = createHash("sha256").update(token).digest("hex");

  const account = await prisma.wAAccount.findFirst({
    where: { verifyTokenHash: hash, status: { not: "DISCONNECTED" } },
  });

  if (!account) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    const signature = req.headers.get("x-hub-signature-256");

    if (body.object !== "whatsapp_business_account") {
      return NextResponse.json({ success: true });
    }

    const entries = body.entry ?? [];

    for (const entry of entries) {
      const changes = entry.changes ?? [];

      for (const change of changes) {
        const value = change.value as WebhookValue;
        if (!value?.metadata?.phone_number_id) continue;

        const phoneNumberId = value.metadata.phone_number_id;

        const account = await prisma.wAAccount.findFirst({
          where: { phoneNumberId },
        });

        if (!account) continue;

        const sigValid = await validateSignature(rawBody, signature, phoneNumberId);
        if (!sigValid && account.appSecret) continue;

        await prisma.wAAccount.update({
          where: { id: account.id },
          data: { lastActivity: new Date() },
        });

        if (value.messages && value.contacts) {
          for (const msg of value.messages) {
            const contact = value.contacts.find((c) => c.wa_id === msg.from);
            const contactName = contact?.profile?.name ?? msg.from;
            const isGroup = msg.from.includes("@g.us");

            const existing = msg.id
              ? await prisma.wAMessage.findFirst({
                  where: { wamid: msg.id },
                  select: { id: true },
                })
              : null;

            if (existing) continue;

            const { mediaId, mimeType } = getMediaInfo(msg);
            const messageBody = getMessageBody(msg);
            const msgTimestamp = new Date(Number(msg.timestamp) * 1000);

            const chat = await prisma.wAChat.upsert({
              where: {
                accountId_remoteJid: {
                  accountId: account.id,
                  remoteJid: msg.from,
                },
              },
              create: {
                accountId: account.id,
                remoteJid: msg.from,
                name: contactName,
                isGroup,
                lastMessage: messageBody.slice(0, 500),
                lastMessageAt: msgTimestamp,
                unreadCount: 1,
              },
              update: {
                name: contactName,
                isGroup,
                lastMessage: messageBody.slice(0, 500),
                lastMessageAt: msgTimestamp,
                unreadCount: { increment: 1 },
              },
            });

            await prisma.wAMessage.create({
              data: {
                wamid: msg.id,
                chatId: chat.id,
                direction: "INBOUND",
                messageType: msg.type,
                body: messageBody,
                mediaId,
                mimeType,
                timestamp: msgTimestamp,
              },
            });
          }

          const activeBots = await prisma.wABot.findMany({
            where: { waAccountId: account.id, isActive: true, status: "ACTIVE" },
            select: { id: true },
          });

          for (const msg of value.messages) {
            for (const bot of activeBots) {
              const chatForBot = await prisma.wAChat.findUnique({
                where: {
                  accountId_remoteJid: {
                    accountId: account.id,
                    remoteJid: msg.from,
                  },
                },
                select: { id: true },
              });
              if (chatForBot) {
                await botQueue.add("process-message", {
                  botId: bot.id,
                  waChatId: chatForBot.id,
                  incomingMessage: getMessageBody(msg),
                });
              }
            }
          }
        }

        if (value.statuses) {
          for (const status of value.statuses) {
            if (status.id) {
              await prisma.wAMessage.updateMany({
                where: {
                  wamid: status.id,
                  chat: { accountId: account.id },
                },
                data: {
                  status: status.status,
                },
              });

              const statusMap: Record<string, "DELIVERED" | "READ"> = {
                delivered: "DELIVERED",
                read: "READ",
              };
              const recipientStatus = statusMap[status.status];
              if (recipientStatus) {
                const updateData: Record<string, unknown> = { status: recipientStatus };
                if (recipientStatus === "DELIVERED") {
                  updateData.deliveredAt = new Date();
                } else if (recipientStatus === "READ") {
                  updateData.readAt = new Date();
                }
                await prisma.wACampaignRecipient.updateMany({
                  where: { wamid: status.id },
                  data: updateData,
                });
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
