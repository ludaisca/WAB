import { Queue } from "bullmq";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1000 },
  timeout: 60_000,
};

const mediaDownloadJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  timeout: 90_000,
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
