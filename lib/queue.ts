import { Queue } from "bullmq";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

export const botQueue = new Queue("bot-messages", { connection });
export const campaignQueue = new Queue("campaign-send", { connection });
export const ragQueue = new Queue("rag-index", { connection });
