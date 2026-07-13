import { Worker } from "bullmq";
import { processBotMessageJob } from "./bot-worker";
import { processCampaignJob } from "./campaign-worker";
import { processRagJob } from "./rag-worker";
import { processMediaDownloadJob } from "./media-worker";
import { processMediaCleanupJob } from "./media-cleanup-worker";
import { mediaCleanupQueue } from "@/lib/queue";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

let started = false;
const workers: Worker[] = [];

export function startWorkers() {
  if (started) return;
  started = true;

  const botWorker = new Worker("bot-messages", async (job) => {
    await processBotMessageJob(job.data);
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

  workers.push(botWorker, campaignWorker, ragWorker, mediaWorker, mediaCleanupWorker);

  mediaCleanupQueue
    .add(
      "purge",
      {},
      { jobId: "media-cleanup-daily", repeat: { pattern: "0 3 * * *" } }
    )
    .catch((err) => console.error("[workers] No se pudo programar media-cleanup:", err));

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
