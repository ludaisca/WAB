// Taxonomía de "Predicción IA" compartida entre score-correlation.ts
// (servidor, arma la matriz de precisión y resuelve el filtro por etiqueta
// en app/api/crm-ejecutivos/prospects/route.ts) y los componentes cliente de
// CRM Ejecutivos (_accuracy-tab.tsx, _prospects-tab.tsx). Vive en su propio
// módulo client-safe (sin imports de Prisma) por la misma razón que
// lib/whatsapp/media-shared.ts existe separado de media-store.ts — un
// componente "use client" no puede importar un archivo que arrastre Prisma.
import { labelText } from "@/lib/whatsapp/export-columns";

// Las 5 fases de lib/whatsapp/lead-scoring.ts, más dos buckets para
// prospectos con match en WAB que no encajan en una evaluación IA limpia:
// "otro" (label legado — tibio/caliente de scores viejos) y "sin_evaluacion"
// (matcheado pero nunca calificado). Los labels legado no se remapean.
export const AI_LABELS = ["descartado", "frio", "interesado", "oportunidad", "prioridad_alta"] as const;
export type AiLabel = (typeof AI_LABELS)[number] | "otro" | "sin_evaluacion";

const EXTRA_LABEL_TEXT: Record<string, string> = {
  otro: "Otro (label legado)",
  sin_evaluacion: "Sin evaluación IA",
};

export function aiLabelText(label: string): string {
  return EXTRA_LABEL_TEXT[label] ?? labelText(label);
}
