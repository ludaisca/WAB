import { getAIProvider, EMBEDDING_MODEL } from "./factory";

export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const client = getAIProvider(apiKey);
  const res = await client.generateEmbeddings({ model: EMBEDDING_MODEL, input: text });
  return res.embeddings[0];
}

export async function generateEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const client = getAIProvider(apiKey);
  const res = await client.generateEmbeddings({ model: EMBEDDING_MODEL, input: texts });
  return res.embeddings;
}
