import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { matchContactsByPhoneKeys, type ContactMatch } from "@/lib/crm-ejecutivos/match-contacts";
import { matchLeadScores } from "@/lib/crm-ejecutivos/score-correlation";

const PAGE_SIZE = 25;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const trackedExecutiveId = searchParams.get("trackedExecutiveId");
    const isOportunity = searchParams.get("isOportunity");
    const onlyMatched = searchParams.get("onlyMatched") === "true";
    const search = searchParams.get("search")?.trim();

    const where: Prisma.ExternalProspectWhereInput = {
      ...(trackedExecutiveId ? { trackedExecutiveId } : {}),
      ...(isOportunity === "true" ? { isOportunity: true } : {}),
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

    // "Solo con match en WAB" tiene que filtrar ANTES de paginar (no solo
    // ocultar filas de la página actual) — si no, "Siguiente" seguiría
    // avanzando por prospectos sin match de por medio y el conteo/paginación
    // no cuadrarían con lo que el usuario realmente ve. Para eso se resuelve
    // el cruce sobre TODOS los phoneKey distintos que matchean el resto de
    // filtros (acotado por el volumen real de ExternalProspect, no de
    // Contact) y se acota el where con `phoneKey: { in: ... }`.
    let matchedKeysPrefetch: Map<string, ContactMatch> | null = null;
    if (onlyMatched) {
      const distinct = await prisma.externalProspect.findMany({
        where,
        select: { phoneKey: true },
        distinct: ["phoneKey"],
      });
      matchedKeysPrefetch = await matchContactsByPhoneKeys(distinct.map((d) => d.phoneKey));
      where.phoneKey = { in: Array.from(matchedKeysPrefetch.keys()) };
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

    // Si ya se resolvió el cruce completo arriba (onlyMatched), reusarlo en
    // vez de volver a golpear Contact con las mismas claves de esta página.
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
