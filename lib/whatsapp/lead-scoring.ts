import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { wrapUserPrompt } from "@/lib/ai/prompt-sanitizer";
import { estimateCost } from "@/lib/ai/pricing";
import type { AIProvider } from "@/lib/ai/types";
import type { WALeadScorerBot } from "@prisma/client";

// Five-phase funnel (replaces the old frio/tibio/caliente 3-tier system) —
// distinguishes "never engaged" from "explicitly rejected", and separates
// "asked for a quote" from "ready to close", which a flat hot/warm/cold scale
// couldn't. Score bands are enforced by instruction only (the model assigns
// both); parseScoreResponse falls back to deriving the label from the score
// (or vice versa isn't attempted) if the model's label is missing/invalid.
const VALID_LABELS = ["descartado", "frio", "interesado", "oportunidad", "prioridad_alta"] as const;

function labelFromScore(score: number): (typeof VALID_LABELS)[number] {
  if (score <= 0) return "descartado";
  if (score <= 15) return "frio";
  if (score <= 35) return "interesado";
  if (score <= 65) return "oportunidad";
  return "prioridad_alta";
}

// This is the shared, non-negotiable methodology every calificador follows —
// the business-specific criteria (what counts as qualified, what products
// exist, etc.) stay in the scorer's own systemPrompt above this. Adapted from
// a battle-tested n8n SDR-audit prompt: explicit-text-only discipline, a
// 5-phase funnel with score bands, and structured CRM/briefing extraction.
const JSON_CONTRACT = `Eres además un auditor de calidad de leads. Aplica SIEMPRE estas reglas de análisis, además del criterio de negocio de las instrucciones anteriores:

- Basa tu análisis SOLO en mensajes explícitos del lead (los marcados "Lead:" en la transcripción). No infieras ni completes datos que no estén dichos — si un dato no está explícito, usa null (o [] para listas).
- Prioriza los mensajes más recientes del lead si hay contradicciones con mensajes anteriores.
- Mensajes ofensivos, agresivos, o de rechazo explícito del lead → label "descartado" y score 0, sin excepción.
- Si el lead responde y delega la revisión a un tercero (ej. "lo reviso con el doctor/socio/área técnica"), es una señal de interés real, no de frialdad — normalmente clasifica como "interesado" u "oportunidad", no "frio".

Clasifica en UNA de estas 5 fases, con un score dentro de su rango:
- "descartado" (score 0 fijo): no relacionado con el negocio, contacto equivocado, spam, o rechazo explícito. Si aplica, no evalúes nada más — deja "details" con sus valores en null/[].
- "frio" (score 1-15): solo un mensaje automático, o preguntó algo genérico ("info", "precio") y no volvió a responder. Score más alto si mencionó algo concreto del negocio aunque no continuó.
- "interesado" (score 16-35): hay conversación real — explica qué busca, da contexto — pero NO ha pedido cotización, llamada o visita todavía. Score más alto si está cerca de pedirla o hizo preguntas concretas.
- "oportunidad" (score 36-65): necesidad clara + pidió cotización, llamada, visita o evaluación comercial. Score más alto con urgencia o detalles concretos.
- "prioridad_alta" (score 66-100): igual que "oportunidad" + al menos una señal explícita de: fecha definida, presupuesto mencionado, quien decide es quien escribe, o intención de compra inmediata. Score más alto cuando todo está confirmado.

Responde ÚNICAMENTE con un bloque \`\`\`json ... \`\`\` sin texto adicional antes o después, con esta forma exacta:
{"score": number (0-100), "label": "descartado"|"frio"|"interesado"|"oportunidad"|"prioridad_alta", "summary": string, "reasons": string[], "details": {"tipo_lead": "nuevo_contacto"|"seguimiento"|"reactivacion"|"desconocido"|null, "necesidad_principal": string|null, "contexto_negocio": string|null, "senales_compra": string[], "objeciones_dudas": string[], "nivel_interaccion": "bajo"|"medio"|"alto", "tono_interes": "exploratorio"|"comparativo"|"decidido"|"urgente"|"negativo"|"derivado"|null, "proximos_pasos": string[], "nombre_real": string|null, "producto_interes": string|null, "urgencia": string|null, "presupuesto": string|null}}

summary es un resumen narrativo de 3-5 líneas basado solo en lo explícito. reasons son 2-4 motivos breves y concretos (señales de compra u objeciones reales — "receptivo" o "cordial" no cuentan como motivo). senales_compra y objeciones_dudas: máximo 3 elementos cada una, listas vacías si no aplica. nivel_interaccion "medio" solo si hubo respuesta con continuidad o pregunta propia del lead; una confirmación breve sin siguiente paso es "bajo".`;

interface ScoreDetails {
  tipo_lead: string | null;
  necesidad_principal: string | null;
  contexto_negocio: string | null;
  senales_compra: string[];
  objeciones_dudas: string[];
  nivel_interaccion: string | null;
  tono_interes: string | null;
  proximos_pasos: string[];
  nombre_real: string | null;
  producto_interes: string | null;
  urgencia: string | null;
  presupuesto: string | null;
}

export class LeadScoringError extends Error {}

// Shared by the manual "Calificar" button (score/route.ts) and the scheduled
// tick worker (lead-scoring-worker.ts) so both paths score identically and
// log usage the same way — usage logging matters here because the scheduled
// path runs unattended and its cost needs to show up in budget checks.
export async function scoreChatWithScorer(chatId: string, scorer: WALeadScorerBot) {
  const messages = await prisma.wAMessage.findMany({
    where: { chatId },
    orderBy: { timestamp: "asc" },
    take: 200,
    select: { direction: true, body: true, caption: true, messageType: true },
  });

  if (messages.length === 0) {
    throw new LeadScoringError("La conversación no tiene mensajes");
  }

  const provider = scorer.provider as AIProvider;
  const apiKey = await getUserApiKey(scorer.userId, provider);
  if (!apiKey) {
    throw new LeadScoringError("Falta configurar la clave del proveedor de IA");
  }

  const transcript = messages
    .map((m) => {
      const text = m.caption ?? m.body ?? `[${m.messageType}]`;
      return `${m.direction === "INBOUND" ? "Lead" : "Agente"}: ${text}`;
    })
    .join("\n");

  const client = getAIProvider(provider, apiKey);
  const result = await client.complete({
    model: scorer.model,
    temperature: 0.2,
    maxTokens: 600,
    messages: [
      { role: "system", content: wrapUserPrompt(scorer.systemPrompt) },
      { role: "system", content: JSON_CONTRACT },
      { role: "user", content: transcript.slice(0, 12000) },
    ],
  });

  const parsed = parseScoreResponse(result.content);
  if (!parsed) {
    throw new LeadScoringError("La IA no devolvió un resultado válido");
  }

  const leadScore = await prisma.wALeadScore.upsert({
    where: { chatId_scorerId: { chatId, scorerId: scorer.id } },
    create: {
      chatId,
      scorerId: scorer.id,
      score: parsed.score,
      label: parsed.label,
      summary: parsed.summary,
      reasons: JSON.stringify(parsed.reasons),
      details: parsed.details as object,
      model: scorer.model,
    },
    update: {
      score: parsed.score,
      label: parsed.label,
      summary: parsed.summary,
      reasons: JSON.stringify(parsed.reasons),
      details: parsed.details as object,
      model: scorer.model,
    },
    include: { scorer: { select: { id: true, name: true } } },
  });

  if (result.usage) {
    const promptTokens = result.usage.promptTokens;
    const completionTokens = result.usage.completionTokens;
    const totalTokens = promptTokens + completionTokens;
    const cost = await estimateCost(scorer.model, promptTokens, completionTokens, provider);

    await prisma.wALeadScorerUsage.create({
      data: {
        scorerId: scorer.id,
        waChatId: chatId,
        model: scorer.model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: cost,
      },
    });
  }

  return leadScore;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function stringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, max);
}

function parseDetails(raw: unknown): ScoreDetails {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    tipo_lead: stringOrNull(d.tipo_lead),
    necesidad_principal: stringOrNull(d.necesidad_principal),
    contexto_negocio: stringOrNull(d.contexto_negocio),
    senales_compra: stringArray(d.senales_compra, 3),
    objeciones_dudas: stringArray(d.objeciones_dudas, 3),
    nivel_interaccion: stringOrNull(d.nivel_interaccion),
    tono_interes: stringOrNull(d.tono_interes),
    proximos_pasos: stringArray(d.proximos_pasos, 5),
    nombre_real: stringOrNull(d.nombre_real),
    producto_interes: stringOrNull(d.producto_interes),
    urgencia: stringOrNull(d.urgencia),
    presupuesto: stringOrNull(d.presupuesto),
  };
}

function parseScoreResponse(raw: string): { score: number; label: string; summary: string; reasons: string[]; details: ScoreDetails } | null {
  try {
    // Prefer the fenced ```json block we asked for — falls back to a greedy
    // {...} match for models that ignore the fencing instruction.
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/);
    const jsonMatch = fencedMatch ? fencedMatch[1] : raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) return null;
    const data = JSON.parse(jsonMatch);

    let score = Math.max(0, Math.min(100, Math.round(Number(data.score))));
    if (Number.isNaN(score)) return null;

    const label = VALID_LABELS.includes(data.label) ? data.label : labelFromScore(score);
    if (label === "descartado") score = 0;

    const summary = typeof data.summary === "string" ? data.summary : "";
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((r: unknown) => typeof r === "string") : [];
    const details = parseDetails(data.details);

    if (!summary) return null;

    return { score, label, summary, reasons, details };
  } catch {
    return null;
  }
}
