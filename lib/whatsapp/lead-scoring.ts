import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { wrapUserPrompt } from "@/lib/ai/prompt-sanitizer";
import { estimateCost } from "@/lib/ai/pricing";
import type { AIProvider } from "@/lib/ai/types";
import type { WALeadScorerBot } from "@prisma/client";

const VALID_LABELS = ["frio", "tibio", "caliente"] as const;

const JSON_CONTRACT =
  "Responde ÚNICAMENTE con un bloque ```json ... ``` que contenga el objeto, sin texto adicional antes o después, con esta forma exacta: " +
  '{"score": number (0-100), "label": "frio"|"tibio"|"caliente", "summary": string, "reasons": string[]}. ' +
  "summary es un resumen de 1-2 frases de la conversación. reasons son 2-4 motivos breves de la calificación.";

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
      model: scorer.model,
    },
    update: {
      score: parsed.score,
      label: parsed.label,
      summary: parsed.summary,
      reasons: JSON.stringify(parsed.reasons),
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

function parseScoreResponse(raw: string): { score: number; label: string; summary: string; reasons: string[] } | null {
  try {
    // Prefer the fenced ```json block we asked for — falls back to a greedy
    // {...} match for models that ignore the fencing instruction.
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/);
    const jsonMatch = fencedMatch ? fencedMatch[1] : raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) return null;
    const data = JSON.parse(jsonMatch);

    const score = Math.max(0, Math.min(100, Math.round(Number(data.score))));
    const label = VALID_LABELS.includes(data.label) ? data.label : score >= 66 ? "caliente" : score >= 33 ? "tibio" : "frio";
    const summary = typeof data.summary === "string" ? data.summary : "";
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((r: unknown) => typeof r === "string") : [];

    if (Number.isNaN(score) || !summary) return null;

    return { score, label, summary, reasons };
  } catch {
    return null;
  }
}
