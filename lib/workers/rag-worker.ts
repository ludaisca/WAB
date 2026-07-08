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
  if (!apiKey) return;

  const chunks = chunkText(content);

  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i], provider, apiKey);

      const knowledgeId = crypto.randomUUID();

      await prisma.$executeRawUnsafe(
        `INSERT INTO "wa_bot_knowledge" ("id", "title", "content", "embedding", "chunk_index", "source_name", "created_at")
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
      console.error(`[rag-worker] Error processing chunk ${i}:`, err instanceof Error ? err.message : err);
    }
  }
}
