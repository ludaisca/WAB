import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { matchContactsByPhoneKeys, type ContactMatch, type ContactMatchEntry } from "@/lib/crm-ejecutivos/match-contacts";
import { matchLeadScores, resolveAiLabel } from "@/lib/crm-ejecutivos/score-correlation";
import { zonedDateTimeToUtc } from "@/lib/timezone";

const PAGE_SIZE = 25;

// Mismo orden de prioridad que StatusBadge en _prospects-tab.tsx — el select
// "Estado" tiene que devolver exactamente las filas cuyo badge en pantalla
// coincide con lo elegido, no una combinación de flags independiente entre sí.
function statusWhere(status: string): Prisma.ExternalProspectWhereInput | null {
  switch (status) {
    case "cliente": return { isClient: true };
    case "rechazado": return { isClient: false, rejected: true };
    case "descartado": return { isClient: false, rejected: false, discarted: true };
    case "oportunidad": return { isClient: false, rejected: false, discarted: false, isOportunity: true };
    case "prospecto": return { isClient: false, rejected: false, discarted: false, isOportunity: false };
    default: return null;
  }
}

function serializeMatchEntry(e: ContactMatchEntry) {
  return { ...e, lastMessageAt: e.lastMessageAt?.toISOString() ?? null };
}

// El cliente recibe `primary` (usado por default para el link "Ver chat" y
// la Predicción IA) y `all` (todas las coincidencias, para mostrar cuando el
// teléfono aparece en más de una cuenta — ver el comentario en match-contacts.ts).
function serializeMatch(match: ContactMatch | null) {
  if (!match) return null;
  return { primary: serializeMatchEntry(match.primary), all: match.all.map(serializeMatchEntry) };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const trackedExecutiveId = searchParams.get("trackedExecutiveId");
    const status = searchParams.get("status");
    const onlyMatched = searchParams.get("onlyMatched") === "true";
    const aiLabel = searchParams.get("aiLabel");
    // Un prospecto "sin_evaluacion" tiene match en WAB pero nunca generó una
    // conversación/calificación real ahí — típicamente fue asignado al
    // ejecutivo por otro canal (llamada, etc.), lo cual está bien, pero no
    // aporta nada a "trazar la ruta de leads calificados en WAB" (el uso
    // principal de este módulo). Este flag oculta ese ruido sin obligar a
    // elegir una a una las 5 etiquetas reales en el select de Predicción IA.
    const excludeUnevaluated = searchParams.get("excludeUnevaluated") === "true";
    const search = searchParams.get("search")?.trim();
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const sourceCreatedAt: Prisma.DateTimeFilter = {};
    if (dateFrom) sourceCreatedAt.gte = zonedDateTimeToUtc(dateFrom, "00:00");
    if (dateTo) {
      // Límite superior EXCLUSIVO: medianoche CDMX del día siguiente al
      // elegido — evita el error de "23:59:59Z" que en CDMX es ~18:00, no
      // medianoche (mismo criterio que lib/reports/date-range.ts).
      const [y, m, d] = dateTo.split("-").map(Number);
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      sourceCreatedAt.lt = zonedDateTimeToUtc(nextDay, "00:00");
    }

    const where: Prisma.ExternalProspectWhereInput = {
      ...(trackedExecutiveId ? { trackedExecutiveId } : {}),
      ...(status && status !== "all" ? (statusWhere(status) ?? {}) : {}),
      ...(Object.keys(sourceCreatedAt).length > 0 ? { sourceCreatedAt } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { product: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // "Solo con match en WAB", "Predicción IA" y "excluir sin evaluar"
    // tienen que resolverse ANTES de paginar (no solo ocultar filas de la
    // página actual) — si no, "Siguiente" seguiría avanzando por prospectos
    // que no cumplen y el conteo/paginación no cuadrarían con lo que el
    // usuario realmente ve. Los tres comparten la misma resolución: se
    // cruza sobre TODOS los phoneKey distintos que matchean el resto de
    // filtros (acotado por el volumen real de ExternalProspect, no de
    // Contact) y se acota el where con `phoneKey: { in: ... }`.
    const hasExactAiLabel = !!aiLabel && aiLabel !== "all";
    const needsMatchResolution = onlyMatched || excludeUnevaluated || hasExactAiLabel;
    let matchedKeysPrefetch: Map<string, ContactMatch> | null = null;
    if (needsMatchResolution) {
      const distinct = await prisma.externalProspect.findMany({
        where,
        select: { phoneKey: true },
        distinct: ["phoneKey"],
      });
      matchedKeysPrefetch = await matchContactsByPhoneKeys(distinct.map((d) => d.phoneKey));

      if (hasExactAiLabel || excludeUnevaluated) {
        const candidateChatIds = Array.from(matchedKeysPrefetch.values())
          .map((m) => m.primary.chatId)
          .filter((id): id is string => !!id);
        const candidateScores = await matchLeadScores(candidateChatIds);
        const keep = new Set<string>();
        for (const [phoneKey, match] of matchedKeysPrefetch) {
          const label = resolveAiLabel(match, candidateScores);
          // Un aiLabel exacto (incluyendo "sin_evaluacion" elegido a propósito
          // en el select) manda sobre excludeUnevaluated — es una selección
          // más específica que el checkbox de "ocultar ruido".
          if (hasExactAiLabel) {
            if (label === aiLabel) keep.add(phoneKey);
          } else if (label && label !== "sin_evaluacion") {
            keep.add(phoneKey);
          }
        }
        where.phoneKey = { in: Array.from(keep) };
      } else {
        where.phoneKey = { in: Array.from(matchedKeysPrefetch.keys()) };
      }
    }

    const [total, rows] = await Promise.all([
      prisma.externalProspect.count({ where }),
      prisma.externalProspect.findMany({
        where,
        orderBy: { sourceCreatedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { trackedExecutive: { select: { id: true, label: true, phone: true } } },
      }),
    ]);

    // Si ya se resolvió el cruce completo arriba (onlyMatched o aiLabel),
    // reusarlo en vez de volver a golpear Contact con las mismas claves de
    // esta página.
    const matches = matchedKeysPrefetch ?? (await matchContactsByPhoneKeys(rows.map((r) => r.phoneKey)));

    // Predicción IA de WAB por chat matcheado — acotado a los chatId de la
    // página actual (como mucho PAGE_SIZE), mismo criterio de "bounded by
    // page" que matchContactsByPhoneKeys de arriba.
    const chatIds = rows
      .map((r) => matches.get(r.phoneKey)?.primary.chatId)
      .filter((id): id is string => !!id);
    const scores = await matchLeadScores(chatIds);

    const items = rows.map((r) => {
      const match = matches.get(r.phoneKey) ?? null;
      const score = match?.primary.chatId ? scores.get(match.primary.chatId) : undefined;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        product: r.product,
        campaign: r.campaign,
        observations: r.observations,
        isOportunity: r.isOportunity,
        isClient: r.isClient,
        rejected: r.rejected,
        rejectedReason: r.rejectedReason,
        discarted: r.discarted,
        discartedReason: r.discartedReason,
        lastTrackingReason: r.lastTrackingReason,
        lastTrackingAt: r.lastTrackingAt?.toISOString() ?? null,
        salesCount: r.salesCount,
        pipelineStatus: r.pipelineStatus,
        pipelinePhaseId: r.pipelinePhaseId,
        nextPendingAt: r.nextPendingAt?.toISOString() ?? null,
        oportunityAt: r.oportunityAt?.toISOString() ?? null,
        clientAt: r.clientAt?.toISOString() ?? null,
        rejectedAt: r.rejectedAt?.toISOString() ?? null,
        reassignedAt: r.reassignedAt?.toISOString() ?? null,
        trackings: r.trackings,
        sourceCreatedAt: r.sourceCreatedAt.toISOString(),
        sourceUpdatedAt: r.sourceUpdatedAt.toISOString(),
        trackedExecutive: r.trackedExecutive,
        wab: serializeMatch(match),
        aiScore: score ? { label: score.label, score: score.score, scorerName: score.scorerName, updatedAt: score.updatedAt.toISOString() } : null,
      };
    });

    return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
