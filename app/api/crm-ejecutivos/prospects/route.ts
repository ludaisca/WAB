import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { matchContactsByPhoneKeys, type ContactMatch } from "@/lib/crm-ejecutivos/match-contacts";
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

    // "Solo con match en WAB" y el filtro "Predicción IA" tienen que
    // resolverse ANTES de paginar (no solo ocultar filas de la página
    // actual) — si no, "Siguiente" seguiría avanzando por prospectos que no
    // cumplen y el conteo/paginación no cuadrarían con lo que el usuario
    // realmente ve. Un aiLabel específico implica matched (solo un prospecto
    // con match puede tener predicción), así que ambos comparten la misma
    // resolución: se cruza sobre TODOS los phoneKey distintos que matchean
    // el resto de filtros (acotado por el volumen real de ExternalProspect,
    // no de Contact) y se acota el where con `phoneKey: { in: ... }`.
    const needsMatchResolution = onlyMatched || (!!aiLabel && aiLabel !== "all");
    let matchedKeysPrefetch: Map<string, ContactMatch> | null = null;
    if (needsMatchResolution) {
      const distinct = await prisma.externalProspect.findMany({
        where,
        select: { phoneKey: true },
        distinct: ["phoneKey"],
      });
      matchedKeysPrefetch = await matchContactsByPhoneKeys(distinct.map((d) => d.phoneKey));

      if (aiLabel && aiLabel !== "all") {
        const candidateChatIds = Array.from(matchedKeysPrefetch.values())
          .map((m) => m.chatId)
          .filter((id): id is string => !!id);
        const candidateScores = await matchLeadScores(candidateChatIds);
        const keep = new Set<string>();
        for (const [phoneKey, match] of matchedKeysPrefetch) {
          if (resolveAiLabel(match, candidateScores) === aiLabel) keep.add(phoneKey);
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
      .map((r) => matches.get(r.phoneKey)?.chatId)
      .filter((id): id is string => !!id);
    const scores = await matchLeadScores(chatIds);

    const items = rows.map((r) => {
      const match = matches.get(r.phoneKey) ?? null;
      const score = match?.chatId ? scores.get(match.chatId) : undefined;
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
        wab: match,
        aiScore: score ? { label: score.label, score: score.score, scorerName: score.scorerName, updatedAt: score.updatedAt.toISOString() } : null,
      };
    });

    return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
