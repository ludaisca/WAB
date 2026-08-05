export interface ModelPricing {
  input: number;
  output: number;
}

export interface ModelOption {
  id: string;
  name: string;
  pricing?: ModelPricing;
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
