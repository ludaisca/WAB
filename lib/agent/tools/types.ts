// Contrato de un tool del agente de IA — ver plan en
// ~/.claude/plans/glowing-conjuring-engelbart.md §3.
export type ToolRiskTier = "READ" | "MINOR" | "CONFIRM";

export interface ToolContext {
  userId: string;
  conversationId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<P = any> {
  name: string;
  riskTier: ToolRiskTier;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  // READ/MINOR: ejecuta inline.
  handler?: (params: P, ctx: ToolContext) => Promise<unknown>;
  // CONFIRM: describe lo que se haría (texto legible para el humano + los params
  // ya normalizados) sin ejecutar nada todavía.
  describeConfirm?: (params: P, ctx: ToolContext) => Promise<{ description: string; params: P }>;
  // CONFIRM: SOLO la invoca el endpoint de confirmación (app/api/agent/actions/[id]/confirm) —
  // el orchestrator nunca importa esta función.
  executeConfirm?: (params: P, ctx: ToolContext) => Promise<unknown>;
}
