import { withMaintenanceGuard } from "@/lib/maintenance-guard";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, fetchLastInboundMessages, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";
import { getChatVisibilityFilter } from "@/lib/whatsapp/chat-visibility";

async function handleGET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const accountIds = await getUserAccountIds(session.user.id);

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    if (accountId && !accountIds.includes(accountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const where: Record<string, unknown> = {
      accountId: accountId ? accountId : { in: accountIds },
    };

    const chatId = searchParams.get("chatId");
    if (chatId) where.id = chatId;

    // Búsqueda server-side: con la lista paginada, filtrar solo lo ya cargado
    // en el cliente hacía imposible encontrar chats antiguos.
    const search = searchParams.get("search")?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { remoteJid: { contains: search } },
        { lastMessage: { contains: search, mode: "insensitive" } },
      ];
    }

    const statusParam = searchParams.get("status");
    if (statusParam) {
      const statuses = statusParam.split(",").filter((s) => ["OPEN", "PENDING", "RESOLVED"].includes(s));
      if (statuses.length > 0) where.status = { in: statuses };
    }

    // Ambos filtros son sobre la relación messages[] — se combinan vía AND en
    // lugar de asignar dos veces where.messages, que se pisarían entre sí.
    const messageFilters: Record<string, unknown>[] = [];

    const triage = searchParams.get("triage");
    if (triage === "unread") where.unreadCount = { gt: 0 };
    if (triage === "pending") where.status = "PENDING";
    if (triage === "failed") messageFilters.push({ messages: { some: { direction: "OUTBOUND", status: "FAILED", timestamp: { gte: new Date(Date.now() - 7 * 86_400_000) } } } });

    const campaignIdParam = searchParams.get("campaignId");
    if (campaignIdParam) {
      // El parámetro acepta tanto una campaña masiva como una fuente de Facebook Ads
      // (LeadSheetSource) — ambas son "de dónde salió el chat" y sus ids (cuid) no chocan.
      messageFilters.push({
        messages: { some: { OR: [{ campaignId: campaignIdParam }, { leadSheetSourceId: campaignIdParam }] } },
      });
    }

    const hasRepliedParam = searchParams.get("hasReplied");
    if (hasRepliedParam === "yes") {
      messageFilters.push({ messages: { some: { direction: "INBOUND" } } });
    } else if (hasRepliedParam === "no") {
      messageFilters.push({ messages: { none: { direction: "INBOUND" } } });
    }

    // La visibilidad por rol viaja en el mismo AND que los filtros de
    // messages[] — asignarla aparte a where.AND la pisaría (o al revés).
    const visibility = await getChatVisibilityFilter(session.user.id, session.user.role, accountIds);
    if (visibility) messageFilters.push(visibility);

    if (messageFilters.length > 0) {
      where.AND = messageFilters;
    }

    // Siempre paginado. Antes, sin `page` en la query, esta ruta devolvía TODAS
    // las conversaciones (138k en producción): la consulta revienta con el
    // límite de parámetros de Prisma (negation filters no se pueden partir) y
    // el cliente recibía un 500 a los 30 s. Los dos consumidores del inbox
    // mandan `page` explícito, así que el modo "array plano" no tenía uso real.
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize")) || 30, 1), 100);

    const select = {
      id: true,
      accountId: true,
      remoteJid: true,
      name: true,
      isGroup: true,
      lastMessage: true,
      lastMessageAt: true,
      unreadCount: true,
      contactId: true,
      status: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
      account: {
        select: { id: true, name: true, phoneNumber: true },
      },
      // Lista negra: badge "Bloqueado" en la fila del chat.
      contact: { select: { blockedAt: true } },
      // Most recent campaign- or lead-source-attributed message, if any —
      // powers the campaign badge in the chat list without a separate round
      // trip per row.
      messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
    } as const;

    const [rows, total] = await Promise.all([
      prisma.wAChat.findMany({
        where,
        select,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        skip: searchParams.has("offset") ? Math.max(0, Math.floor(Number(searchParams.get("offset")) || 0)) : (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.wAChat.count({ where }),
    ]);

    // Último mensaje entrante por chat (una sola consulta batcheada): define la
    // ventana de servicio de 24 h de Meta, que el composer usa para bloquear el
    // texto libre y ofrecer plantilla.
    const lastInbound = await fetchLastInboundMessages(rows.map((r) => r.id));

    const chats = rows.map(({ messages, ...chat }) => ({
      ...chat,
      campaign: resolveChatAttribution(messages),
      lastInboundAt: lastInbound.get(chat.id)?.toISOString() ?? null,
    }));

    return NextResponse.json({ items: chats, total, page, pageSize });
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withMaintenanceGuard(handleGET);
