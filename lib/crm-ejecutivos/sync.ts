import { prisma } from "@/lib/prisma";
import { fetchAllProspects, type RawExternalProspect } from "./client";
import { phoneKey } from "./phone-match";

export interface SyncResult {
  trackedExecutiveId: string;
  phone: string;
  fetched: number;
  error: string | null;
}

function mapProspect(raw: RawExternalProspect, trackedExecutiveId: string) {
  const name = raw.fullname || [raw.name, raw.lastname].filter(Boolean).join(" ") || raw.phone;
  return {
    externalId: raw.id,
    trackedExecutiveId,
    name,
    phone: raw.phone,
    phoneKey: phoneKey(raw.phone),
    email: raw.email || null,
    product: raw.product || null,
    campaign: raw.campaign || null,
    observations: raw.observations || null,
    isOportunity: !!raw.isoportunity,
    isClient: !!raw.isclient,
    rejected: !!raw.rejected,
    rejectedReason: raw.rejectedreason || null,
    discarted: !!raw.discarted,
    discartedReason: raw.discartedreason || null,
    lastTrackingReason: raw.lastTracking?.reason || null,
    lastTrackingAt: raw.lastTrackingcreatedAt ? new Date(raw.lastTrackingcreatedAt) : null,
    sourceCreatedAt: new Date(raw.createdAt),
    sourceUpdatedAt: new Date(raw.updatedAt),
    raw: raw as object,
    syncedAt: new Date(),
  };
}

// Resync completo de un ejecutivo: trae TODOS sus prospectos actuales y hace
// upsert por externalId (crea los nuevos, refresca estado en los que ya
// existían — así un prospecto que pasó de "prospecto" a "isclient" días
// después de la primera sync también se refleja, no solo altas). No borra
// filas locales de prospectos que el CRM externo ya no reporte para ese
// ejecutivo (reasignación a otro ejecutivo, por ejemplo) — se quedan como
// última copia conocida en vez de desaparecer silenciosamente; si en el
// futuro hace falta detectarlas como "huérfanas" habría que comparar el set
// de externalId visto en esta corrida contra lo ya guardado.
export async function syncTrackedExecutive(executive: { id: string; phone: string }): Promise<SyncResult> {
  try {
    const raws = await fetchAllProspects(executive.phone);
    for (const raw of raws) {
      const data = mapProspect(raw, executive.id);
      await prisma.externalProspect.upsert({
        where: { externalId: raw.id },
        create: data,
        update: data,
      });
    }
    return { trackedExecutiveId: executive.id, phone: executive.phone, fetched: raws.length, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { trackedExecutiveId: executive.id, phone: executive.phone, fetched: 0, error: message };
  }
}

export async function syncAllTrackedExecutives(): Promise<SyncResult[]> {
  const executives = await prisma.trackedExecutive.findMany({
    where: { active: true },
    select: { id: true, phone: true },
  });

  const results: SyncResult[] = [];
  for (const executive of executives) {
    results.push(await syncTrackedExecutive(executive));
    // Mismo respiro entre ejecutivos que template-sync-worker.ts / campaign-worker.ts
    // usan entre cuentas — no golpear el CRM externo con ráfagas.
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}
