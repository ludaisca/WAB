import { NextResponse } from "next/server";
import { createHmac, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-message";

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

  if (!account?.appSecret) return false;

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
            const { mediaId, mimeType } = getMediaInfo(msg);

            await ingestInboundMessage(account.id, {
              remoteJid: msg.from,
              wamid: msg.id ?? null,
              timestamp: new Date(Number(msg.timestamp) * 1000),
              type: msg.type,
              body: getMessageBody(msg),
              contactName,
              isGroup: msg.from.includes("@g.us"),
              mediaId,
              mimeType,
            });
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

              const statusMap: Record<string, { status: string; field?: string }> = {
                sent: { status: "SENT", field: "sentAt" },
                delivered: { status: "DELIVERED", field: "deliveredAt" },
                read: { status: "READ", field: "readAt" },
                failed: { status: "FAILED" },
              };
              const mapped = statusMap[status.status];
              if (mapped) {
                const updateData: Record<string, unknown> = { status: mapped.status };
                if (mapped.field === "sentAt") {
                  updateData.sentAt = new Date();
                } else if (mapped.field === "deliveredAt") {
                  updateData.deliveredAt = new Date();
                } else if (mapped.field === "readAt") {
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
