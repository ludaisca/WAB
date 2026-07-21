import { prisma } from "@/lib/prisma";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { getUserApiKey } from "@/lib/ai/settings";
import type { AIProvider } from "@/lib/ai/types";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

interface RagJob {
  title: string;
  content: string;
  botIds: string[];
  provider: AIProvider;
  userId: string;
  sourceName?: string;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export async function processRagJob(job: RagJob) {
  const { title, content, botIds, provider, userId, sourceName } = job;

  const apiKey = await getUserApiKey(userId, provider);
  if (!apiKey) {
    await notifyIndexFailure(userId, title, "No hay API key configurada para el proveedor de este bot.", botIds);
    return;
  }

  const chunks = chunkText(content);
  let failedChunks = 0;
  let lastError = "";

  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i], provider, apiKey);

      const knowledgeId = crypto.randomUUID();

      await prisma.$executeRawUnsafe(
        `INSERT INTO "wa_bot_knowledge" ("id", "title", "content", "embedding", "chunkIndex", "sourceName", "created_at")
         VALUES ($1, $2, $3, $4::vector, $5, $6, NOW())`,
        knowledgeId,
        title,
        chunks[i],
        `[${embedding.join(",")}]`,
        i,
        sourceName ?? null
      );

      for (const botId of botIds) {
        await prisma.wABotKnowledgeBot.create({
          data: { knowledgeId, botId },
        });
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      failedChunks++;
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[rag-worker] Error processing chunk ${i}:`, lastError);
    }
  }

  // Every chunk failed (e.g. embedding model unavailable) — the document never got
  // indexed but nothing else in the pipeline surfaces that to the user, so notify.
  if (chunks.length > 0 && failedChunks === chunks.length) {
    await notifyIndexFailure(userId, title, lastError, botIds);
  }
}

async function notifyIndexFailure(userId: string, title: string, reason: string, botIds: string[]) {
  await prisma.notification.create({
    data: {
      userId,
      type: "BOT_ERROR",
      title: `Error al indexar "${title}"`,
      body: reason.slice(0, 500),
      // "/whatsapp/conocimiento" fue eliminada en el aplanamiento de nav 2026-07 —
      // la pestaña de conocimiento vive ahora solo dentro de whatsapp/bots/[id].
      link: botIds[0] ? `/whatsapp/bots/${botIds[0]}` : "/whatsapp/bots",
    },
  });
}
