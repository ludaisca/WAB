import { prisma } from "@/lib/prisma";
import { generateEmbedding } from "./embeddings";
import type { AIProvider } from "./types";

const SIMILARITY_THRESHOLD = 0.5;
const MAX_CHUNKS = 5;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function chunkText(text: string): string[] {
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

export async function indexDocument(
  title: string,
  content: string,
  botIds: string[],
  provider: AIProvider,
  apiKey: string,
  sourceName?: string
) {
  const chunks = chunkText(content);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i], provider, apiKey);

    const knowledgeId = `${Date.now()}_${i}`;

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
  }
}

export async function searchKnowledge(
  botId: string,
  query: string,
  provider: AIProvider,
  apiKey: string
): Promise<string | null> {
  const queryEmbedding = await generateEmbedding(query, provider, apiKey);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const results = await prisma.$queryRawUnsafe<
    Array<{ content: string; similarity: number }>
  >(
    `SELECT k.content, 1 - (k.embedding <=> $1::vector) AS similarity
     FROM "wa_bot_knowledge" k
     JOIN "wa_bot_knowledge_bots" kb ON k.id = kb.knowledge_id
     WHERE kb.bot_id = $2
       AND 1 - (k.embedding <=> $1::vector) > $3
     ORDER BY similarity DESC
     LIMIT $4`,
    vectorStr,
    botId,
    SIMILARITY_THRESHOLD,
    MAX_CHUNKS
  );

  if (!results || results.length === 0) return null;

  return results.map((r) => r.content).join("\n\n---\n\n");
}

export async function getKnowledgeForBot(botId: string) {
  return prisma.wABotKnowledgeBot.findMany({
    where: { botId },
    select: {
      knowledge: {
        select: {
          id: true,
          title: true,
          chunkIndex: true,
          sourceName: true,
          createdAt: true,
        },
      },
    },
    orderBy: [
      { knowledge: { title: "asc" } },
      { knowledge: { chunkIndex: "asc" } },
    ],
  });
}

export async function unlinkKnowledgeFromBot(knowledgeId: string, botId: string) {
  const botLinks = await prisma.wABotKnowledgeBot.findMany({
    where: { knowledgeId },
  });

  await prisma.wABotKnowledgeBot.delete({
    where: { knowledgeId_botId: { knowledgeId, botId } },
  });

  if (botLinks.length <= 1) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "wa_bot_knowledge" WHERE id = $1`,
      knowledgeId
    );
  }
}

export async function getBotCountForKnowledge(knowledgeId: string) {
  return prisma.wABotKnowledgeBot.count({ where: { knowledgeId } });
}
