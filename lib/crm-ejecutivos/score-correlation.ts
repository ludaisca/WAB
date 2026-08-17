// Cruce entre la calificación de IA de WAB (WALeadScore) y el resultado
// real que el ejecutivo humano registró en el CRM externo (ExternalProspect)
// — responde "¿mi IA predijo bien?" comparando la etiqueta que le puso al
// lead contra lo que de verdad pasó después (oportunidad/cliente/rechazo).
//
// Mismo idioma que lib/reports/queries/dashboard.ts: findMany acotado +
// agregación en memoria, nada de anidar relaciones filtradas en un
// findMany grande (ver el gotcha de fetchChatAttributions en CLAUDE.md).
import { prisma } from "@/lib/prisma";
import { matchContactsByPhoneKeys } from "./match-contacts";

export interface LeadScoreMatch {
  label: string;
  score: number;
  scorerName: string;
  updatedAt: Date;
}

// Evaluación IA más reciente por chat — no por scorer. Un chat puede tener
// scores de varios WALeadScorerBot; para esta comparación interesa el
// juicio más actual de la IA sobre ese lead, sin importar cuál calificador
// lo produjo. Mismo patrón "latest row per group" que ya usa
// fetchChatAttributions en lib/whatsapp/chat-attribution.ts.
export async function matchLeadScores(chatIds: string[]): Promise<Map<string, LeadScoreMatch>> {
  if (chatIds.length === 0) return new Map();

  const rows = await prisma.wALeadScore.findMany({
    where: { chatId: { in: chatIds } },
    distinct: ["chatId"],
    orderBy: [{ chatId: "asc" }, { updatedAt: "desc" }],
    select: { chatId: true, label: true, score: true, updatedAt: true, scorer: { select: { name: true } } },
  });

  const map = new Map<string, LeadScoreMatch>();
  for (const r of rows) {
    map.set(r.chatId, { label: r.label, score: r.score, scorerName: r.scorer.name, updatedAt: r.updatedAt });
  }
  return map;
}

// Etiquetas de la taxonomía de 5 fases de lib/whatsapp/lead-scoring.ts, más
// un bucket para prospectos con match en WAB pero sin ninguna evaluación IA
// todavía. Los labels legado (tibio/caliente) de scores viejos se agrupan
// dentro de su fila propia igual — no se intenta remapearlos.
const AI_LABELS = ["descartado", "frio", "interesado", "oportunidad", "prioridad_alta"] as const;
type AiLabel = (typeof AI_LABELS)[number] | "otro" | "sin_evaluacion";

type RealOutcome = "cliente" | "oportunidad" | "rechazado" | "descartado" | "en_proceso";

function realOutcomeOf(p: { isClient: boolean; isOportunity: boolean; rejected: boolean; discarted: boolean }): RealOutcome {
  if (p.isClient) return "cliente";
  if (p.isOportunity) return "oportunidad";
  if (p.rejected) return "rechazado";
  if (p.discarted) return "descartado";
  return "en_proceso";
}

export interface AccuracyRow {
  aiLabel: AiLabel;
  cliente: number;
  oportunidad: number;
  rechazado: number;
  descartado: number;
  en_proceso: number;
  total: number;
  // % de (cliente+oportunidad) sobre el total ya resuelto (excluye
  // en_proceso, que todavía no tiene un desenlace) — mismo criterio de
  // exclusión de "no resuelto" que qualifiedConversionRate en
  // lib/reports/queries/dashboard.ts. null si no hay nada resuelto aún.
  conversionRate: number | null;
}

export interface LeadScoreAccuracy {
  totalMatched: number;
  matrix: AccuracyRow[];
  overallConversionRate: number | null;
}

// Tope defensivo — el volumen real de ExternalProspect hoy es de cientos,
// muy lejos de los 47k+ chats/78k+ mensajes de la tabla más grande del
// sistema (ver memoria wab-large-dataset), pero se pone un límite igual
// para que esta ruta interactiva nunca se convierta en un table scan si el
// volumen crece mucho más adelante.
const MAX_PROSPECTS = 10000;

export async function getLeadScoreAccuracy(trackedExecutiveId?: string): Promise<LeadScoreAccuracy> {
  const prospects = await prisma.externalProspect.findMany({
    where: trackedExecutiveId ? { trackedExecutiveId } : {},
    select: { phoneKey: true, isClient: true, isOportunity: true, rejected: true, discarted: true },
    take: MAX_PROSPECTS,
  });

  const distinctKeys = Array.from(new Set(prospects.map((p) => p.phoneKey)));
  const contactMatches = await matchContactsByPhoneKeys(distinctKeys);

  const chatIds = Array.from(contactMatches.values())
    .map((m) => m.chatId)
    .filter((id): id is string => id !== null);
  const scoreMatches = await matchLeadScores(chatIds);

  const rowsByLabel = new Map<AiLabel, AccuracyRow>();
  function rowFor(label: AiLabel): AccuracyRow {
    let row = rowsByLabel.get(label);
    if (!row) {
      row = { aiLabel: label, cliente: 0, oportunidad: 0, rechazado: 0, descartado: 0, en_proceso: 0, total: 0, conversionRate: null };
      rowsByLabel.set(label, row);
    }
    return row;
  }

  let totalMatched = 0;
  let overallResolved = 0;
  let overallConverted = 0;

  for (const p of prospects) {
    const contactMatch = contactMatches.get(p.phoneKey);
    if (!contactMatch) continue; // sin match en WAB — no participa en la comparación
    totalMatched++;

    const scoreMatch = contactMatch.chatId ? scoreMatches.get(contactMatch.chatId) : undefined;
    const aiLabel: AiLabel = scoreMatch
      ? (AI_LABELS as readonly string[]).includes(scoreMatch.label)
        ? (scoreMatch.label as AiLabel)
        : "otro"
      : "sin_evaluacion";

    const outcome = realOutcomeOf(p);
    const row = rowFor(aiLabel);
    row[outcome]++;
    row.total++;

    if (outcome !== "en_proceso") {
      overallResolved++;
      if (outcome === "cliente" || outcome === "oportunidad") overallConverted++;
    }
  }

  const order: AiLabel[] = [...AI_LABELS, "otro", "sin_evaluacion"];
  const matrix = order
    .filter((label) => rowsByLabel.has(label))
    .map((label) => {
      const row = rowFor(label);
      const resolved = row.total - row.en_proceso;
      row.conversionRate = resolved > 0 ? ((row.cliente + row.oportunidad) / resolved) * 100 : null;
      return row;
    });

  return {
    totalMatched,
    matrix,
    overallConversionRate: overallResolved > 0 ? (overallConverted / overallResolved) * 100 : null,
  };
}
