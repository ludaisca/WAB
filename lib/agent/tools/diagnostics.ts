import { runSystemDiagnostics } from "@/lib/whatsapp/system-diagnostics";
import type { ToolDefinition } from "./types";

export const systemDiagnostics: ToolDefinition<Record<string, never>> = {
  name: "system.diagnostics",
  riskTier: "READ",
  description:
    "Escanea proactivamente cuentas de WhatsApp, campañas, bots, calificadores, plantillas, automatizaciones de Sheets y multimedia pendiente de descarga buscando problemas activos (cuentas en error, campañas atascadas o con fallos altos, bots caídos, tareas programadas que dejaron de correr, plantillas rechazadas por Meta, presupuesto de IA excedido). Úsala para preguntas genéricas tipo '¿hay algo roto?', '¿cómo está el sistema?', 'revisa que todo esté bien' — sin que el usuario tenga que señalar primero un módulo específico. El mismo scan corre cada hora en segundo plano y ya notifica por separado los hallazgos de severidad alta.",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => runSystemDiagnostics(ctx.userId),
};
