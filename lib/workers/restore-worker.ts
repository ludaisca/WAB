import { runRestorePipeline } from "@/lib/backup/restore-backup";

// restoreQueue tiene attempts:1 (ver lib/queue.ts) — nunca hay retry
// automático de una restauración, así que no hace falta lógica de intentos
// aquí. runRestorePipeline ya deja SystemRestoreLog en FAILED y notifica antes
// de relanzar el error si algo sale mal.
export async function processRestoreJob(data: { restoreLogId: string }): Promise<void> {
  await runRestorePipeline(data.restoreLogId);
}
