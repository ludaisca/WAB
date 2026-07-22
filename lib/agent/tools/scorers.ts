import { prisma } from "@/lib/prisma";
import { setScorerSchedule, deleteScorer } from "@/lib/whatsapp/lead-scorers";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

const MAX_LIST = 40;

export const scorersList: ToolDefinition<Record<string, never>> = {
  name: "scorers.list",
  riskTier: "READ",
  description: "Lista los calificadores de leads (nombre, proveedor/modelo, si la corrida programada está activa).",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => {
    const scorers = await prisma.wALeadScorerBot.findMany({
      where: { userId: ctx.userId },
      select: { id: true, name: true, provider: true, model: true, isActive: true, scheduleEnabled: true, scheduleIntervalMinutes: true, lastRunAt: true },
      orderBy: { createdAt: "desc" },
    });
    return { scorers };
  },
};

export const scorersGet: ToolDefinition<{ scorerId: string }> = {
  name: "scorers.get",
  riskTier: "READ",
  description: "Detalle completo de un calificador, incluido su systemPrompt.",
  parameters: { type: "object", properties: { scorerId: { type: "string" } }, required: ["scorerId"] },
  handler: async (params, ctx) => {
    const scorer = await prisma.wALeadScorerBot.findFirst({ where: { id: params.scorerId, userId: ctx.userId } });
    if (!scorer) return { error: "Calificador no encontrado" };
    return scorer;
  },
};

export const scorersScoresList: ToolDefinition<{ scorerId?: string; label?: string; limit?: number }> = {
  name: "scorers.scores.list",
  riskTier: "READ",
  description: "Lista leads calificados por IA (score, label, resumen), opcionalmente filtrados por calificador o por label (frio/interesado/oportunidad/prioridad_alta/descartado). Esta es LA herramienta para cualquier pregunta sobre \"leads calificados\" o sobre esas 5 etiquetas — no es lo mismo que el leadStatus del contacto (NEW/CONTACTED/QUALIFIED/CUSTOMER/LOST, ver contacts.list), que es un campo distinto del embudo CRM manual.",
  parameters: {
    type: "object",
    properties: {
      scorerId: { type: "string" },
      label: { type: "string", enum: ["descartado", "frio", "interesado", "oportunidad", "prioridad_alta"] },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_LIST})` },
    },
  },
  handler: async (params, ctx) => {
    const take = Math.min(params.limit ?? 20, MAX_LIST);
    const scores = await prisma.wALeadScore.findMany({
      where: {
        scorer: { userId: ctx.userId },
        ...(params.scorerId ? { scorerId: params.scorerId } : {}),
        ...(params.label ? { label: params.label } : {}),
      },
      select: {
        id: true, score: true, label: true, summary: true, updatedAt: true,
        scorer: { select: { name: true } },
        chat: { select: { id: true, name: true, remoteJid: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    });
    return { scores };
  },
};

export const scorersScheduleToggle: ToolDefinition<{ scorerId: string; enabled: boolean }> = {
  name: "scorers.schedule.toggle",
  riskTier: "MINOR",
  description: "Activa o desactiva la corrida programada de un calificador (al desactivar se limpia el intervalo configurado).",
  parameters: {
    type: "object",
    properties: { scorerId: { type: "string" }, enabled: { type: "boolean" } },
    required: ["scorerId", "enabled"],
  },
  handler: async (params, ctx) => setScorerSchedule(params.scorerId, ctx.userId, params.enabled),
};

export const scorersDelete: ToolDefinition<{ scorerId: string }> = {
  name: "scorers.delete",
  riskTier: "CONFIRM",
  description: "Elimina permanentemente un calificador de leads y su historial de scores. Requiere confirmación humana.",
  parameters: { type: "object", properties: { scorerId: { type: "string" } }, required: ["scorerId"] },
  describeConfirm: async (params, ctx) => {
    const scorer = await prisma.wALeadScorerBot.findFirst({ where: { id: params.scorerId, userId: ctx.userId }, select: { name: true } });
    if (!scorer) throw new NotFoundError("Calificador no encontrado");
    const scoreCount = await prisma.wALeadScore.count({ where: { scorerId: params.scorerId } });
    return { description: `Eliminar permanentemente el calificador "${scorer.name}" y sus ${scoreCount} leads calificados.`, params };
  },
  executeConfirm: async (params, ctx) => {
    await deleteScorer(params.scorerId, ctx.userId);
    return { success: true };
  },
};
