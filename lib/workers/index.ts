import { Worker } from "bullmq";
import { processBotMessageJob } from "./bot-worker";
import { processCampaignJob } from "./campaign-worker";
import { processRagJob } from "./rag-worker";
import { processMediaDownloadJob } from "./media-worker";
import { processMediaCleanupJob } from "./media-cleanup-worker";
import { processBotSendJob } from "./bot-send-worker";
import { processLeadScoringTick } from "./lead-scoring-worker";
import { processLeadRecoveryTick } from "./lead-recovery-worker";
import { mediaCleanupQueue, leadScoringQueue, leadRecoveryQueue } from "@/lib/queue";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

let started = false;
const workers: Worker[] = [];

export function startWorkers() {
  if (started) return;
  started = true;

  const botWorker = new Worker("bot-messages", async (job) => {
    await processBotMessageJob(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 3 });

  const campaignWorker = new Worker("campaign-send", async (job) => {
    await processCampaignJob(job.data);
  }, { connection, concurrency: 1 });

  const ragWorker = new Worker("rag-index", async (job) => {
    await processRagJob(job.data);
  }, { connection, concurrency: 2 });

  const mediaWorker = new Worker("media-download", async (job) => {
    await processMediaDownloadJob(job.data);
  }, { connection, concurrency: 5 });

  const mediaCleanupWorker = new Worker("media-cleanup", async () => {
    await processMediaCleanupJob();
  }, { connection, concurrency: 1 });

  const botSendWorker = new Worker("bot-message-send", async (job) => {
    await processBotSendJob(job.data);
  }, { connection, concurrency: 5 });

  const leadScoringWorker = new Worker("lead-scoring", async () => {
    await processLeadScoringTick();
  }, { connection, concurrency: 1 });

  const leadRecoveryWorker = new Worker("lead-recovery", async () => {
    await processLeadRecoveryTick();
  }, { connection, concurrency: 1 });

  workers.push(botWorker, campaignWorker, ragWorker, mediaWorker, mediaCleanupWorker, botSendWorker, leadScoringWorker, leadRecoveryWorker);

  mediaCleanupQueue
    .add(
      "purge",
      {},
      { jobId: "media-cleanup-daily", repeat: { pattern: "0 3 * * *" } }
    )
    .catch((err) => console.error("[workers] No se pudo programar media-cleanup:", err));

  // The shortest schedulable interval a scorer can pick is 15 minutes (see
  // LEAD_SCORER_SCHEDULE_INTERVALS) — ticking every 5 minutes gives enough
  // resolution to honor that without polling Redis unnecessarily often.
  leadScoringQueue
    .add(
      "tick",
      {},
      { jobId: "lead-scoring-tick", repeat: { pattern: "*/5 * * * *" } }
    )
    .catch((err) => console.error("[workers] No se pudo programar lead-scoring:", err));

  // Umbrales en horas (mínimo configurable: horas enteras) — un tick cada 15
  // minutos da resolución de sobra sin sondear Redis de más.
  leadRecoveryQueue
    .add(
      "tick",
      {},
      { jobId: "lead-recovery-tick", repeat: { pattern: "*/15 * * * *" } }
    )
    .catch((err) => console.error("[workers] No se pudo programar lead-recovery:", err));

  console.log("[workers] BullMQ workers started");
}

async function shutdown() {
  console.log("[workers] Shutting down workers...");
  await Promise.all(workers.map((w) => w.close()));
  console.log("[workers] Workers shut down");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
