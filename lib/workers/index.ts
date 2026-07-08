import { Worker } from "bullmq";
import { botQueue, campaignQueue, ragQueue } from "@/lib/queue";
import { processBotMessageJob } from "./bot-worker";
import { processCampaignJob } from "./campaign-worker";
import { processRagJob } from "./rag-worker";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

let started = false;

export function startWorkers() {
  if (started) return;
  started = true;

  new Worker("bot-messages", async (job) => {
    await processBotMessageJob(job.data);
  }, { connection, concurrency: 3 });

  new Worker("campaign-send", async (job) => {
    await processCampaignJob(job.data);
  }, { connection, concurrency: 1 });

  new Worker("rag-index", async (job) => {
    await processRagJob(job.data);
  }, { connection, concurrency: 2 });

  console.log("[workers] BullMQ workers started");
}
