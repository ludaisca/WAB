import { prisma } from "@/lib/prisma";

export interface CampaignOriginStats {
  origin: "manual" | "automatizacion";
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  // % sobre mensajes efectivamente enviados (sent+delivered+read+failed) — los
  // "pending"/"skipped" no cuentan como intento, así que quedan fuera del denominador.
  deliveryRate: number | null;
  readRate: number | null;
  // Solo poblado para origin "manual" — las automatizaciones de Sheets no
  // tienen costo de envío calculado.
  costUsd: number | null;
}

export interface CampaignBreakdownRow extends CampaignOriginStats {
  id: string;
  name: string;
}

export interface CampaignSectionStats {
  campaignMessagesByOrigin: CampaignOriginStats[];
  campaignMessageBreakdown: CampaignBreakdownRow[];
  campaignSpendUsd: number;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function toStats(
  counts: { sent: number; delivered: number; read: number; failed: number },
  costUsd: number | null = null
): CampaignOriginStats {
  const total = counts.sent + counts.delivered + counts.read + counts.failed;
  return {
    origin: "manual", // overwritten by callers
    total,
    sent: counts.sent,
    delivered: counts.delivered,
    read: counts.read,
    failed: counts.failed,
    deliveryRate: rate(counts.delivered + counts.read, total),
    readRate: rate(counts.read, total),
    costUsd,
  };
}

type StatusCounts = { sent: number; delivered: number; read: number; failed: number };

function emptyCounts(): StatusCounts {
  return { sent: 0, delivered: 0, read: 0, failed: 0 };
}

// Estadísticas de campañas masivas + automatizaciones de Sheets, acotables
// por cuenta y por rango de fechas. Siempre agrega sobre las tablas de
// DETALLE (WACampaignRecipient/LeadSheetImportedRow) en vez de las columnas
// precalculadas de WACampaign (sentCount/totalCostUsd/...) — esas son
// acumulados de toda la vida y no sirven para acotar por fecha. Con
// `range` undefined se obtiene exactamente el mismo total histórico que esas
// columnas ya dan (incluye recipients FAILED, que nunca tienen `sentAt`).
//
// Un recipient FAILED nunca se llegó a enviar, así que no tiene `sentAt` —
// al pasar un `range`, esas filas quedan fuera del conteo de esa ventana
// (mismo criterio que `inRange()` en lib/reports/date-range.ts: sin fecha,
// no hay forma de saber si cae dentro del rango). LeadSheetImportedRow no
// tiene un campo `sentAt` dedicado — se usa `importedAt` como aproximación;
// esas filas tampoco tienen costo de cualquier forma.
export async function getCampaignSectionStats(
  accountIds: string[],
  range?: { gte: Date; lt: Date } | null
): Promise<CampaignSectionStats> {
  const [campaigns, recipientGroups, leadSheetSources, leadSheetStatusGroups] = await Promise.all([
    prisma.wACampaign.findMany({
      where: { waAccountId: { in: accountIds } },
      select: { id: true, name: true },
    }),
    prisma.wACampaignRecipient.groupBy({
      by: ["campaignId", "status"],
      where: {
        campaign: { waAccountId: { in: accountIds } },
        ...(range ? { sentAt: range } : {}),
      },
      _count: { _all: true },
      _sum: { costUsd: true },
    }),
    prisma.leadSheetSource.findMany({
      where: { waAccountId: { in: accountIds } },
      select: { id: true, name: true },
    }),
    // "seeded" nunca se envió (filas ya presentes al conectar la fuente) — no es
    // un resultado de envío, igual que en sheets-sync.ts.
    prisma.leadSheetImportedRow.groupBy({
      by: ["sourceId", "status"],
      where: {
        source: { waAccountId: { in: accountIds } },
        status: { not: "seeded" },
        ...(range ? { importedAt: range } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  const manualCountsByCampaign = new Map<string, StatusCounts & { costUsd: number }>();
  for (const g of recipientGroups) {
    const entry = manualCountsByCampaign.get(g.campaignId) ?? { ...emptyCounts(), costUsd: 0 };
    const count = g._count._all;
    const cost = g._sum.costUsd ?? 0;
    if (g.status === "SENT") entry.sent += count;
    else if (g.status === "DELIVERED") entry.delivered += count;
    else if (g.status === "READ") entry.read += count;
    else if (g.status === "FAILED") entry.failed += count;
    entry.costUsd += cost;
    manualCountsByCampaign.set(g.campaignId, entry);
  }

  const manualBreakdown: CampaignBreakdownRow[] = campaigns
    .map((c) => {
      const counts = manualCountsByCampaign.get(c.id) ?? { ...emptyCounts(), costUsd: 0 };
      return {
        id: c.id,
        name: c.name,
        ...toStats(counts, counts.costUsd),
        origin: "manual" as const,
      };
    })
    .filter((r) => r.total > 0);

  const leadSheetCountsBySource = new Map<string, StatusCounts>();
  for (const g of leadSheetStatusGroups) {
    const entry = leadSheetCountsBySource.get(g.sourceId) ?? emptyCounts();
    const count = g._count._all;
    // "skipped" (contacto opt-out de marketing) se excluye de las tasas — nunca
    // se intentó enviar, no es una entrega/lectura fallida.
    if (g.status === "sent") entry.sent += count;
    else if (g.status === "delivered") entry.delivered += count;
    else if (g.status === "read") entry.read += count;
    else if (g.status === "failed") entry.failed += count;
    leadSheetCountsBySource.set(g.sourceId, entry);
  }

  const automationBreakdown: CampaignBreakdownRow[] = leadSheetSources
    .map((s) => ({
      id: s.id,
      name: s.name,
      ...toStats(leadSheetCountsBySource.get(s.id) ?? emptyCounts()),
      origin: "automatizacion" as const,
    }))
    .filter((r) => r.total > 0);

  const campaignMessageBreakdown = [...manualBreakdown, ...automationBreakdown].sort((a, b) => b.total - a.total);

  const campaignSpendUsd = manualBreakdown.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);

  const manualTotals = manualBreakdown.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered, read: acc.read + r.read, failed: acc.failed + r.failed }),
    emptyCounts()
  );
  const automationTotals = automationBreakdown.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered, read: acc.read + r.read, failed: acc.failed + r.failed }),
    emptyCounts()
  );

  const campaignMessagesByOrigin: CampaignOriginStats[] = [
    { ...toStats(manualTotals, campaignSpendUsd), origin: "manual" },
    { ...toStats(automationTotals), origin: "automatizacion" },
  ];

  return {
    campaignMessagesByOrigin,
    campaignMessageBreakdown,
    campaignSpendUsd: Math.round(campaignSpendUsd * 10000) / 10000,
  };
}
