export interface ModelPricing {
  input: number;
  output: number;
}

export interface ModelOption {
  id: string;
  name: string;
  pricing?: ModelPricing;
}

// Populated by listOpenRouterModels(), reused by getOpenRouterModelPricing()
// so estimateCost() doesn't need a network call on every message.
let openRouterPricingCache: Map<string, ModelPricing> | null = null;

export async function listOpenRouterModels(apiKey?: string): Promise<ModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de modelos de OpenRouter");
  }

  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  const models = (data.data ?? []).map((m) => {
    const promptPrice = Number(m.pricing?.prompt ?? 0);
    const completionPrice = Number(m.pricing?.completion ?? 0);
    // OpenRouter prices are USD per token; estimateCost() works in USD per 1M tokens.
    const pricing: ModelPricing = { input: promptPrice * 1_000_000, output: completionPrice * 1_000_000 };
    return { id: m.id, name: m.name ?? m.id, pricing };
  });

  openRouterPricingCache = new Map(models.map((m) => [m.id, m.pricing]));

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOpenRouterModelPricing(modelId: string): Promise<ModelPricing | null> {
  if (!openRouterPricingCache) {
    await listOpenRouterModels().catch(() => {});
  }
  return openRouterPricingCache?.get(modelId) ?? null;
}

export async function listGoogleModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de modelos de Google");
  }

  const data = (await res.json()) as {
    models?: Array<{
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName ?? m.name }));
}
