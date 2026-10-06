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

export async function GET(req: Request) {
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
    // Fechas CDMX (lo que el usuario ve en el selector), convertidas a un
    // [gte, lt) UTC exacto — mismo helper que Reportes.
    let updatedAt: { gte?: Date; lt?: Date } | undefined;
    if (DATE_RE.test(dateFrom) && DATE_RE.test(dateTo)) {
      updatedAt = reportRangeToUtc(dateFrom, dateTo);
    } else if (DATE_RE.test(dateFrom)) {
      updatedAt = { gte: reportRangeToUtc(dateFrom, dateFrom).gte };
    } else if (DATE_RE.test(dateTo)) {
      updatedAt = { lt: reportRangeToUtc(dateTo, dateTo).lt };
    }

    const found = await prisma.wALeadScore.findMany({
      where: {
        chat: await chatAccessWhere(session.user.id, session.user.role),
        ...(updatedAt ? { updatedAt } : {}),
      },
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
      orderBy: { updatedAt: "desc" },
      take: MAX_ROWS + 1,
    });
    const truncated = found.length > MAX_ROWS;
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

    return NextResponse.json(rows, { headers: { "X-Truncated": truncated ? "1" : "0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
