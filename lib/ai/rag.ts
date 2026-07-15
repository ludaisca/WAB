import { prisma } from "@/lib/prisma";
import { generateEmbedding } from "./embeddings";
import type { AIProvider } from "./types";

const SIMILARITY_THRESHOLD = 0.5;
const MAX_CHUNKS = 5;

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
     JOIN "wa_bot_knowledge_bots" kb ON k.id = kb."knowledgeId"
     WHERE kb."botId" = $2
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
