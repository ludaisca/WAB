import { NextResponse } from "next/server";
import { createHmac, createHash } from "crypto";
import type { RecipientStatus } from "@prisma/client";
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
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
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
  filename: string | null;
  caption: string | null;
} {
  if (msg.image) return {
    mediaId: msg.image.id,
    mimeType: msg.image.mime_type ?? null,
    filename: null,
    caption: msg.image.caption ?? null,
  };
  if (msg.video) return {
    mediaId: msg.video.id,
    mimeType: msg.video.mime_type ?? null,
    filename: null,
    caption: msg.video.caption ?? null,
  };
  if (msg.audio) return {
    mediaId: msg.audio.id,
    mimeType: msg.audio.mime_type ?? null,
    filename: null,
    caption: null,
  };
  if (msg.document) return {
    mediaId: msg.document.id,
    mimeType: msg.document.mime_type ?? null,
    filename: msg.document.filename ?? null,
    caption: msg.document.caption ?? null,
  };
  return { mediaId: null, mimeType: null, filename: null, caption: null };
}

async function validateSignature(
  body: string,
  signature: string | null,
  appSecret: string | null
): Promise<boolean> {
  if (!signature || !appSecret) return false;

  try {
    const { decrypt } = await import("@/lib/crypto");
    const secret = decrypt(appSecret);
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const received = signature.replace("sha256=", "");
    return expected === received;
  } catch {
    return false;
  }
}

// sent < delivered < read — Meta no garantiza el orden de entrega de los
// webhooks, así que un "delivered" rezagado no debe pisar un "read" ya aplicado.
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

function statusErrorDetail(status: WebhookStatus): string | null {
  const err = status.errors?.[0];
  if (!err) return null;
  return err.error_data?.details ?? err.message ?? err.title ?? (err.code ? `Error ${err.code}` : null);
}

async function applyStatusUpdate(accountId: string, status: WebhookStatus): Promise<void> {
  if (!status.id) return;

  const rank = STATUS_RANK[status.status];
  const lowerStatuses = rank
    ? Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < rank)
    : null;

  await prisma.wAMessage.updateMany({
    where: {
      wamid: status.id,
      chat: { accountId },
      // Solo avanza: para sent/delivered/read exige que el estado actual sea
      // inferior (o inexistente). "failed" y estados desconocidos siempre aplican.
      ...(lowerStatuses
        ? { OR: [{ status: { in: [...lowerStatuses, "pending"] } }, { status: null }] }
        : {}),
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
  if (!mapped) return;

  const updateData: Record<string, unknown> = { status: mapped.status };
  if (mapped.status === "FAILED") {
    const detail = statusErrorDetail(status);
    if (detail) updateData.errorMessage = detail;
  }
  if (mapped.field === "sentAt") {
    updateData.sentAt = new Date();
  } else if (mapped.field === "deliveredAt") {
    updateData.deliveredAt = new Date();
  } else if (mapped.field === "readAt") {
    updateData.readAt = new Date();
  }

  const recipient = await prisma.wACampaignRecipient.findFirst({
    where: { wamid: status.id },
    select: { campaignId: true },
  });
  if (!recipient) return;

  const RECIPIENT_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };
  const recipientRank = RECIPIENT_RANK[mapped.status];
  const recipientLower = recipientRank
    ? (["PENDING", ...Object.keys(RECIPIENT_RANK).filter((s) => RECIPIENT_RANK[s] < recipientRank)] as RecipientStatus[])
    : null;

  await prisma.wACampaignRecipient.updateMany({
    where: {
      wamid: status.id,
      ...(recipientLower ? { status: { in: recipientLower } } : {}),
    },
    data: updateData,
  });

  await syncCampaignCounts(recipient.campaignId);
}

// Recomputed from current recipient statuses (not incremented) so duplicate
// webhook deliveries for the same status stay idempotent. "Entregado" counts
// as delivered-or-further since a READ recipient was necessarily delivered
// first — WhatsApp overwrites status forward, it doesn't keep both.
async function syncCampaignCounts(campaignId: string): Promise<void> {
  const counts = await prisma.wACampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  await prisma.wACampaign.update({
    where: { id: campaignId },
    data: {
      deliveredCount: countOf("DELIVERED") + countOf("READ"),
      readCount: countOf("READ"),
      failedCount: countOf("FAILED"),
    },
  });
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

        const sigValid = await validateSignature(rawBody, signature, account.appSecret);
        if (!sigValid && account.appSecret) continue;

        await prisma.wAAccount.update({
          where: { id: account.id },
          data: { lastActivity: new Date() },
        });

        if (value.messages && value.contacts) {
          const groups = new Map<string, WebhookMessage[]>();
          for (const msg of value.messages) {
            const list = groups.get(msg.from) ?? [];
            list.push(msg);
            groups.set(msg.from, list);
          }

          await Promise.all(
            Array.from(groups.values()).map(async (msgs) => {
              for (const msg of msgs) {
                const contact = value.contacts!.find((c) => c.wa_id === msg.from);
                const contactName = contact?.profile?.name ?? msg.from;
                const { mediaId, mimeType, filename, caption } = getMediaInfo(msg);
                // Meta puede omitir timestamp — un Invalid Date rompería el
                // create de Prisma; se usa "ahora" como respaldo.
                const tsNum = Number(msg.timestamp);
                const timestamp = Number.isFinite(tsNum) && tsNum > 0
                  ? new Date(tsNum * 1000)
                  : new Date();

                await ingestInboundMessage(account.id, {
                  remoteJid: msg.from,
                  wamid: msg.id ?? null,
                  timestamp,
                  type: msg.type,
                  body: getMessageBody(msg),
                  contactName,
                  isGroup: msg.from.includes("@g.us"),
                  mediaId,
                  mimeType,
                  filename,
                  caption,
                });
              }
            })
          );
        }

        if (value.statuses) {
          await Promise.all(
            value.statuses.map((status) => applyStatusUpdate(account.id, status))
          );
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
