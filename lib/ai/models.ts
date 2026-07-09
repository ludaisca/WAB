export interface ModelOption {
  id: string;
  name: string;
}

export async function listOpenRouterModels(apiKey?: string): Promise<ModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de modelos de OpenRouter");
  }

  const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };

  return (data.data ?? [])
    .map((m) => ({ id: m.id, name: m.name ?? m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
