import { prisma } from "@/lib/prisma";
import {
  botQueue,
  campaignQueue,
  ragQueue,
  mediaDownloadQueue,
  mediaCleanupQueue,
  botSendQueue,
  leadScoringQueue,
  leadRecoveryQueue,
  sheetsSyncQueue,
  leadSheetImportQueue,
  templateSyncQueue,
  agentActionExpiryQueue,
  systemDiagnosticsQueue,
  backupQueue,
  restoreQueue,
} from "@/lib/queue";

// Las 13 colas existentes + backup/restore — pausarlas TODAS durante una
// restauración evita que cualquier worker escriba en la DB mientras
// pg_restore corre. Pausar restoreQueue no mata el job de restauración en
// curso (BullMQ deja terminar los jobs "active", solo bloquea los que aún no
// arrancaron) — es una segunda barrera contra un restore concurrente, además
// del guard explícito a nivel API.
const ALL_QUEUES = [
  botQueue,
  campaignQueue,
  ragQueue,
  mediaDownloadQueue,
  mediaCleanupQueue,
  botSendQueue,
  leadScoringQueue,
  leadRecoveryQueue,
  sheetsSyncQueue,
  leadSheetImportQueue,
  templateSyncQueue,
  agentActionExpiryQueue,
  systemDiagnosticsQueue,
  backupQueue,
  restoreQueue,
];

const SYSTEM_CONFIG_ID = "default";

// Sin cache deliberadamente: es una fila única y este es el gate más sensible
// del sistema (el webhook de WhatsApp lo consulta en cada POST) — no vale la
// pena arriesgar staleness por ahorrar un findUnique barato.
export async function isMaintenanceMode(): Promise<boolean> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: SYSTEM_CONFIG_ID },
    select: { maintenanceMode: true },
  });
  return config?.maintenanceMode ?? false;
}

export async function enterMaintenanceMode(reason: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { id: SYSTEM_CONFIG_ID },
    update: { maintenanceMode: true, maintenanceReason: reason, maintenanceStartedAt: new Date() },
    create: { id: SYSTEM_CONFIG_ID, maintenanceMode: true, maintenanceReason: reason, maintenanceStartedAt: new Date() },
  });
  await Promise.all(ALL_QUEUES.map((q) => q.pause()));
}

export async function exitMaintenanceMode(): Promise<void> {
  await Promise.all(ALL_QUEUES.map((q) => q.resume()));
  await prisma.systemConfig.upsert({
    where: { id: SYSTEM_CONFIG_ID },
    update: { maintenanceMode: false, maintenanceReason: null, maintenanceStartedAt: null },
    create: { id: SYSTEM_CONFIG_ID, maintenanceMode: false },
  });
}
