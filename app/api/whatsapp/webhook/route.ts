import { NextResponse } from "next/server";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import type { RecipientStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-message";
import { isMaintenanceMode } from "@/lib/system-maintenance";

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

// Payload de Meta para el campo `phone_number_quality_update` — no llega con
// `metadata.phone_number_id` (no es un evento "de mensaje"), así que la cuenta
// se resuelve por wabaId + número.
interface QualityUpdateValue {
  display_phone_number?: string;
  event?: string; // p. ej. "FLAGGED" | "UNFLAGGED" | "GREEN" | "YELLOW" | "RED"
  current_limit?: string; // p. ej. "TIER_1K"
}

// Payload para el campo `account_update` — reporta baneos/restricciones y otros
// cambios de estado de la cuenta. Tampoco trae metadata.phone_number_id.
interface AccountUpdateValue {
  phone_number?: string;
  event?: string;
  ban_info?: { waba_ban_state?: string; waba_ban_date?: string };
}

// Payload para el campo `user_preferences` — opt-out/opt-in nativo de WhatsApp
// para mensajes de marketing. Sí trae metadata (es por número, como messages).
interface UserPreferencesValue {
  metadata?: { phone_number_id?: string };
  user_preferences?: Array<{
    wa_id?: string;
    category?: string; // "marketing_messages"
    value?: string; // "stop" | "resume"
  }>;
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
    // Comparación en tiempo constante: `===` sobre strings hace short-circuit en
    // el primer byte distinto y filtra por timing cuánto del prefijo acertó un
    // atacante. Si difieren en longitud (firma malformada) no hay nada que
    // comparar → false sin lanzar.
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(received, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
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

  // Mismo tracking de entrega/lectura que WACampaignRecipient, pero para envíos
  // disparados por una fuente de leads automática (LeadSheetImportedRow usa
  // strings en minúscula, no el enum RecipientStatus). Independiente del bloque
  // de campañas de abajo — un wamid solo puede pertenecer a una de las dos tablas.
  const leadSheetStatus = mapped.status.toLowerCase();
  const LEAD_SHEET_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
  const leadSheetRank = LEAD_SHEET_RANK[leadSheetStatus];
  const leadSheetLower = leadSheetRank
    ? Object.keys(LEAD_SHEET_RANK).filter((s) => LEAD_SHEET_RANK[s] < leadSheetRank)
    : null;

  const leadSheetUpdateData: Record<string, unknown> = { status: leadSheetStatus };
  if (leadSheetStatus === "failed") {
    const detail = statusErrorDetail(status);
    if (detail) leadSheetUpdateData.errorMessage = detail;
  }
  if (mapped.field === "deliveredAt") leadSheetUpdateData.deliveredAt = new Date();
  if (mapped.field === "readAt") leadSheetUpdateData.readAt = new Date();

  await prisma.leadSheetImportedRow.updateMany({
    where: {
      wamid: status.id,
      ...(leadSheetLower ? { status: { in: leadSheetLower } } : {}),
    },
    data: leadSheetUpdateData,
  });

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

function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits || null;
}

// account_update / phone_number_quality_update no traen phone_number_id (van a
// nivel de número/WABA, no de mensaje) — se resuelve por wabaId y, si hay más
// de un número bajo la misma WABA, se desambigua comparando el número reportado
// (normalizado) contra WAAccount.phoneNumber. Si no hay forma de desambiguar,
// no se adivina: se registra y se ignora el evento.
async function resolveAccountByWabaAndPhone(wabaId: string | undefined, phoneRaw: string | undefined) {
  if (!wabaId) return null;
  const candidates = await prisma.wAAccount.findMany({ where: { wabaId } });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    console.warn(`[webhook] wabaId ${wabaId} tiene ${candidates.length} cuentas y el evento no trae número — se omite`);
    return null;
  }
  const match = candidates.find((a) => normalizePhone(a.phoneNumber) === phone);
  if (!match) {
    console.warn(`[webhook] No se encontró cuenta con número ${phone} bajo wabaId ${wabaId}`);
  }
  return match ?? null;
}

async function applyPhoneNumberQualityUpdate(wabaId: string | undefined, value: QualityUpdateValue) {
  const account = await resolveAccountByWabaAndPhone(wabaId, value.display_phone_number);
  if (!account) return;

  const rating = value.event ?? null;
  const tier = value.current_limit ?? null;

  await prisma.wAAccount.update({
    where: { id: account.id },
    data: { qualityRating: rating, messagingTier: tier, qualityUpdatedAt: new Date() },
  });

  // Solo se notifica en señales negativas — un UPGRADE/GREEN no amerita alertar
  // al admin, solo se refleja en el badge de la cuenta.
  if (rating && /flag|downgrade|red|yellow/i.test(rating)) {
    await prisma.notification.create({
      data: {
        userId: account.userId,
        type: "ACCOUNT_STATUS",
        title: `Calidad del número "${account.name}" bajó`,
        body: `Meta reportó: ${rating}${tier ? ` — límite de envío: ${tier}` : ""}`,
        link: `/whatsapp/cuentas/${account.id}`,
      },
    });
  }
}

async function applyAccountUpdate(wabaId: string | undefined, value: AccountUpdateValue) {
  const account = await resolveAccountByWabaAndPhone(wabaId, value.phone_number);
  if (!account) return;

  const eventName = value.event ?? "UPDATE";
  const isRestriction = !!value.ban_info || /ban|disable|restrict|flag/i.test(eventName);

  if (isRestriction) {
    const detail = value.ban_info?.waba_ban_state
      ? `${eventName} (${value.ban_info.waba_ban_state})`
      : eventName;
    await prisma.wAAccount.update({
      where: { id: account.id },
      data: { status: "ERROR", errorMessage: `Meta reportó: ${detail}` },
    });
  }

  await prisma.notification.create({
    data: {
      userId: account.userId,
      type: "ACCOUNT_STATUS",
      title: `Cuenta "${account.name}": ${eventName}`,
      body: isRestriction
        ? "Meta restringió o marcó esta cuenta — revisa el estado en Cuentas WhatsApp."
        : `Actualización reportada por Meta: ${eventName}`,
      link: `/whatsapp/cuentas/${account.id}`,
    },
  });
}

async function applyUserPreferences(value: UserPreferencesValue) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const account = await prisma.wAAccount.findFirst({ where: { phoneNumberId } });
  if (!account) return;

  for (const pref of value.user_preferences ?? []) {
    if (pref.category !== "marketing_messages" || !pref.wa_id) continue;
    const optedOut = pref.value === "stop";
    await prisma.contact.updateMany({
      where: { accountId: account.id, remoteJid: pref.wa_id },
      data: { optedOutMarketing: optedOut, optedOutAt: optedOut ? new Date() : null },
    });
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
    // Restauración de backup en curso — se responde 503 para que Meta
    // reintregue la entrega más tarde (best-effort, no garantizado) en vez de
    // dejar que cualquier ruta escriba en la DB mientras pg_restore corre.
    // Solo aplica al POST, nunca al GET de verificación (debe responder
    // siempre o Meta puede desactivar el webhook).
    if (await isMaintenanceMode()) {
      return new NextResponse("Sistema en mantenimiento, reintenta en unos minutos", { status: 503 });
    }

    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    const signature = req.headers.get("x-hub-signature-256");

    if (body.object !== "whatsapp_business_account") {
      return NextResponse.json({ success: true });
    }

    const entries = body.entry ?? [];

    for (const entry of entries) {
      // Para whatsapp_business_account, entry.id es el WABA ID — lo necesitan
      // account_update/phone_number_quality_update, que no traen phone_number_id.
      const wabaId: string | undefined = entry.id;
      const changes = entry.changes ?? [];

      for (const change of changes) {
        const field = change.field as string | undefined;

        if (field === "phone_number_quality_update") {
          const value = change.value as QualityUpdateValue;
          const account = await resolveAccountByWabaAndPhone(wabaId, value.display_phone_number);
          if (account) {
            const sigValid = await validateSignature(rawBody, signature, account.appSecret);
            if (sigValid || !account.appSecret) {
              await applyPhoneNumberQualityUpdate(wabaId, value);
            }
          }
          continue;
        }

        if (field === "account_update") {
          const value = change.value as AccountUpdateValue;
          const account = await resolveAccountByWabaAndPhone(wabaId, value.phone_number);
          if (account) {
            const sigValid = await validateSignature(rawBody, signature, account.appSecret);
            if (sigValid || !account.appSecret) {
              await applyAccountUpdate(wabaId, value);
            }
          }
          continue;
        }

        if (field === "user_preferences") {
          const value = change.value as UserPreferencesValue;
          const phoneNumberId = value.metadata?.phone_number_id;
          const account = phoneNumberId
            ? await prisma.wAAccount.findFirst({ where: { phoneNumberId } })
            : null;
          if (account) {
            const sigValid = await validateSignature(rawBody, signature, account.appSecret);
            if (sigValid || !account.appSecret) {
              await applyUserPreferences(value);
            }
          }
          continue;
        }

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
