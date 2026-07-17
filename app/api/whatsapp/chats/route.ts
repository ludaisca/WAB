import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";

export async function GET(req: Request) {
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

    const campaignIdParam = searchParams.get("campaignId");
    if (campaignIdParam) {
      messageFilters.push({ messages: { some: { campaignId: campaignIdParam } } });
    }

    const hasRepliedParam = searchParams.get("hasReplied");
    if (hasRepliedParam === "yes") {
      messageFilters.push({ messages: { some: { direction: "INBOUND" } } });
    } else if (hasRepliedParam === "no") {
      messageFilters.push({ messages: { none: { direction: "INBOUND" } } });
    }

    if (messageFilters.length > 0) {
      where.AND = messageFilters;
    }

    // Paginación opt-in: sin `page`/`pageSize` en la query se preserva el
    // comportamiento legado (array plano completo) para los consumidores
    // que aún no la usan (dashboard/page.tsx, whatsapp/page.tsx).
    const pageParam = searchParams.get("page");
    const paginate = pageParam !== null;
    const page = Math.max(1, Number(pageParam) || 1);
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
      // Most recent campaign- or lead-source-attributed message, if any —
      // powers the campaign badge in the chat list without a separate round
      // trip per row.
      messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
    } as const;

    const [rows, total] = await Promise.all([
      prisma.wAChat.findMany({
        where,
        select,
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      paginate ? prisma.wAChat.count({ where }) : Promise.resolve(null),
    ]);

    const chats = rows.map(({ messages, ...chat }) => ({
      ...chat,
      campaign: resolveChatAttribution(messages),
    }));

    if (paginate) {
      return NextResponse.json({ items: chats, total, page, pageSize });
    }
    return NextResponse.json(chats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
