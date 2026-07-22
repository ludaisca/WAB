import { Queue } from "bullmq";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1000 },
  // No hay timeout de ejecución por job en BullMQ 5.x (JobsOptions no tiene un
  // campo `timeout` — el que existía aquí antes no hacía nada). El throughput
  // real depende de `concurrency` por worker y de la propia detección de
  // "stalled jobs" de BullMQ, no de un límite de tiempo forzado por job.
};

const mediaDownloadJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  // Ídem — sin timeout de ejecución por job real en esta configuración.
};

export const botQueue = new Queue("bot-messages", { connection, defaultJobOptions });
export const campaignQueue = new Queue("campaign-send", { connection, defaultJobOptions });
export const ragQueue = new Queue("rag-index", { connection, defaultJobOptions });
export const mediaDownloadQueue = new Queue("media-download", {
  connection,
  defaultJobOptions: mediaDownloadJobOptions,
});
export const mediaCleanupQueue = new Queue("media-cleanup", { connection, defaultJobOptions });
export const botSendQueue = new Queue("bot-message-send", { connection, defaultJobOptions });
export const leadScoringQueue = new Queue("lead-scoring", { connection, defaultJobOptions });
export const leadRecoveryQueue = new Queue("lead-recovery", { connection, defaultJobOptions });
export const sheetsSyncQueue = new Queue("sheets-sync", { connection, defaultJobOptions });
export const leadSheetImportQueue = new Queue("lead-sheet-import", { connection, defaultJobOptions });
export const templateSyncQueue = new Queue("template-sync", { connection, defaultJobOptions });
export const agentActionExpiryQueue = new Queue("agent-action-expiry", { connection, defaultJobOptions });
export const systemDiagnosticsQueue = new Queue("system-diagnostics", { connection, defaultJobOptions });
