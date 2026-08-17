// Analítica derivada del historial de seguimientos (ExternalProspect.trackings)
// y de las fechas de transición de pipeline ya modeladas — mezcla de canales
// usados por los ejecutivos y velocidad de cierre (primer contacto → cliente).
// Mismo idioma que lib/reports/queries/dashboard.ts: findMany acotado +
// agregación en memoria.
import { prisma } from "@/lib/prisma";
import type { RawTracking } from "./client";

export interface ChannelMixEntry {
  action: string;
  count: number;
}

export interface TimeToCloseStats {
  count: number;
  avgDays: number | null;
  medianDays: number | null;
}

export interface TrackingAnalytics {
  channelMix: ChannelMixEntry[];
  timeToClose: TimeToCloseStats;
}

// Mismo tope defensivo que score-correlation.ts — el volumen real hoy es de
// cientos, no decenas de miles.
const MAX_PROSPECTS = 10000;

export async function getTrackingAnalytics(trackedExecutiveId?: string): Promise<TrackingAnalytics> {
  const prospects = await prisma.externalProspect.findMany({
    where: trackedExecutiveId ? { trackedExecutiveId } : {},
    select: { trackings: true, sourceCreatedAt: true, isClient: true, clientAt: true },
    take: MAX_PROSPECTS,
  });

  const channelCounts = new Map<string, number>();
  const closeDurationsDays: number[] = [];

  for (const p of prospects) {
    const trackings = (p.trackings as unknown as RawTracking[] | null) ?? [];
    for (const t of trackings) {
      const action = t.action?.trim() || "Sin especificar";
      channelCounts.set(action, (channelCounts.get(action) ?? 0) + 1);
    }

    // No depende de `trackings` — sourceCreatedAt/clientAt ya están en
    // columnas propias, así que esto cubre TODOS los clientes, no solo los
    // que tuvieron historial sincronizado.
    if (p.isClient && p.clientAt) {
      const days = (p.clientAt.getTime() - p.sourceCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) closeDurationsDays.push(days);
    }
  }

  const channelMix = Array.from(channelCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count);

  closeDurationsDays.sort((a, b) => a - b);
  const avgDays = closeDurationsDays.length
    ? closeDurationsDays.reduce((sum, d) => sum + d, 0) / closeDurationsDays.length
    : null;
  const medianDays = closeDurationsDays.length
    ? closeDurationsDays[Math.floor(closeDurationsDays.length / 2)]
    : null;

  return {
    channelMix,
    timeToClose: { count: closeDurationsDays.length, avgDays, medianDays },
  };
}
