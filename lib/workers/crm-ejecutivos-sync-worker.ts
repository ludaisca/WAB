// Tick desatendido + trigger manual ("Sincronizar ahora" en /crm-ejecutivos)
// comparten esta misma función — no hay lógica distinta entre ambos, solo
// distinto disparador (ver POST /api/crm-ejecutivos/sync-now). Ver
// lib/crm-ejecutivos/sync.ts para la lógica real de resync.
import { syncAllTrackedExecutives } from "@/lib/crm-ejecutivos/sync";

export async function processCrmEjecutivosSyncTick(): Promise<void> {
  const results = await syncAllTrackedExecutives();
  for (const r of results) {
    if (r.error) {
      console.error(`[crm-ejecutivos-sync] Error sincronizando ejecutivo ${r.phone}:`, r.error);
    }
  }
}
