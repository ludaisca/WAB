import { getAIProvider, getEmbeddingModel } from "./factory";
import type { AIProvider } from "./types";

export async function generateEmbedding(
  text: string,
  provider: AIProvider,
  apiKey: string
): Promise<number[]> {
  const client = getAIProvider(provider, apiKey);
  const model = getEmbeddingModel(provider);
  const res = await client.generateEmbeddings({ model, input: text });
  return res.embeddings[0];
}

export async function generateEmbeddings(
  texts: string[],
  provider: AIProvider,
  apiKey: string
): Promise<number[][]> {
  const client = getAIProvider(provider, apiKey);
  const model = getEmbeddingModel(provider);
  const res = await client.generateEmbeddings({ model, input: texts });
  return res.embeddings;
}
