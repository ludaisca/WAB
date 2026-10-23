import { withMaintenanceGuard } from "@/lib/maintenance-guard";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import {
  fetchChatAttributions,
  fetchLastInboundMessages,
} from "@/lib/whatsapp/chat-attribution";
import { reportRangeToUtc } from "@/lib/reports/date-range";
import { ensurePublicChatTokensForChats, publicChatUrl } from "@/lib/whatsapp/chat-public-link";

// Tope de seguridad, no de paginación: el rango de fechas (default 30 días en
// la UI) es lo que acota el resultado. Antes el tope era 500 ordenados por
// score DESC, lo que cortaba justo los estados bajos (frío/descartado) en
// cuanto había más de 500 calificaciones — "no salen todos los estados".
const MAX_ROWS = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleGET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // chatAccessWhere() ya trae accountId + la restricción de
    // hideUnattributedChats — sin esto, "Leads calificados" (abierta a todos
    // los roles) le mostraba a un user/ejecutivo el detalle de chats que su
    // propio inbox les esconde a propósito.
    const params = new URL(req.url).searchParams;
    const dateFrom = params.get("dateFrom") ?? "";
    const dateTo = params.get("dateTo") ?? "";
    for (const date of [dateFrom, dateTo]) {
      if (date && (!DATE_RE.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) {
        return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
      }
    }
    if (dateFrom && dateTo && dateFrom > dateTo) return NextResponse.json({ error: "El rango de fechas no es válido" }, { status: 400 });
    let updatedAt: { gte?: Date; lt?: Date } | undefined;
    if (dateFrom && dateTo) updatedAt = reportRangeToUtc(dateFrom, dateTo);
    else if (dateFrom) updatedAt = { gte: reportRangeToUtc(dateFrom, dateFrom).gte };
    else if (dateTo) updatedAt = { lt: reportRangeToUtc(dateTo, dateTo).lt };
    const scope = await chatAccessWhere(session.user.id, session.user.role);
    const baseWhere: Prisma.WALeadScoreWhereInput = { chat: scope, ...(updatedAt ? { updatedAt } : {}) };
    const accountId = params.get("accountId");
    const scorerId = params.get("scorerId");
    const label = params.get("label");
    const ids = params.get("ids")?.split(",").filter(Boolean);
    if (ids && ids.length > 100) return NextResponse.json({ error: "Máximo 100 selecciones por solicitud" }, { status: 400 });
    const where: Prisma.WALeadScoreWhereInput = {
      ...baseWhere,
      ...(accountId ? { chat: { AND: [scope, { accountId }] } } : {}),
      ...(scorerId ? { scorerId } : {}), ...(label ? { label } : {}), ...(ids ? { id: { in: ids } } : {}),
    };
    const paginate = params.has("page");
    const numberParam = (key: string, fallback: number) => {
      const value = Number(params.get(key) ?? fallback);
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };
    const page = numberParam("page", 1);
    const pageSize = Math.min(numberParam("pageSize", 25), 100);
    // Catalogs ignore the currently selected label/account, but honor the date
    // range and visibility. Options cannot disappear on a sparse result page.
    const includeOptions = paginate && params.get("options") === "1";
    const [total, scorers, accounts] = await Promise.all([
      paginate ? prisma.wALeadScore.count({ where }) : Promise.resolve(0),
      includeOptions ? prisma.wALeadScorerBot.findMany({ where: { scores: { some: baseWhere } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
      includeOptions ? prisma.wAAccount.findMany({ where: { chats: { some: { AND: [scope, { leadScores: { some: { ...(updatedAt ? { updatedAt } : {}) } } }] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ]);

    const found = await prisma.wALeadScore.findMany({
      where,
      include: {
        scorer: { select: { id: true, name: true } },
        chat: {
          select: {
            id: true,
            name: true,
            remoteJid: true,
            status: true,
            accountId: true,
            account: { select: { id: true, name: true, origen: true, leadIdPrefix: true } },
            contact: { select: { realName: true, leadNumber: true } },
            publicShareToken: true,
          },
        },
      },
      // Lo más reciente primero: si se llega al tope, lo que se corta es lo
      // más viejo, no un estado completo de la escala.
      orderBy: paginate ? [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }],
      ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : { take: MAX_ROWS + 1 }),
    });
    const truncated = !paginate && found.length > MAX_ROWS;
    const scores = (truncated ? found.slice(0, MAX_ROWS) : found).sort((a, b) => b.score - a.score);

    // Un token por chat, no por score — un mismo chat puede tener varios
    // WALeadScore (uno por calificador) y todos deben apuntar al mismo link.
    const tokens = await ensurePublicChatTokensForChats(
      scores.map((s) => ({ id: s.chat.id, publicShareToken: s.chat.publicShareToken }))
    );
    const chatIds = scores.map((s) => s.chat.id);
    const lastInbound = await fetchLastInboundMessages(chatIds);
    // Atribución en lotes planos (no anidada en el findMany): con miles de
    // filas Prisma no puede partir la relación con filtros de negación.
    const attributions = await fetchChatAttributions(chatIds);

    const rows = scores.map(({ chat, ...score }) => {
      const { publicShareToken, contact, ...chatRest } = chat;
      return {
        ...score,
        chat: {
          ...chatRest,
          // BigInt no es serializable por NextResponse.json() — convertir aquí.
          contact: contact ? { ...contact, leadNumber: contact.leadNumber.toString() } : null,
          publicLink: publicChatUrl(tokens.get(chat.id)!),
          lastInboundAt: lastInbound.get(chat.id)?.toISOString() ?? null,
        },
        campaign: attributions.get(chat.id) ?? null,
      };
    });

    if (paginate) return NextResponse.json({ items: rows, total, page, pageSize, ...(includeOptions ? { options: { scorers, accounts } } : {}) });
    return NextResponse.json(rows, { headers: { "X-Truncated": truncated ? "1" : "0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withMaintenanceGuard(handleGET);
