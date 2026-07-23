// Metadata client-safe (sin imports de Prisma) — export-entities.ts la
// re-exporta junto con la lógica de fetch server-only. Mismo split que
// media-store.ts/media-shared.ts para el mismo problema (un componente
// cliente necesita la lista de entidades sin arrastrar Prisma al bundle).
export const EXPORT_ENTITIES = [
  "contacts",
  "chats",
  "messages",
  "campaigns",
  "campaignRecipients",
  "templates",
  "leadScores",
  "leadSheetSources",
  "leadSheetImportedRows",
  "notes",
  "aiUsage",
] as const;

export type ExportEntityKey = (typeof EXPORT_ENTITIES)[number];

export const EXPORT_ENTITY_LABELS: Record<ExportEntityKey, string> = {
  contacts: "Contactos",
  chats: "Chats",
  messages: "Mensajes",
  campaigns: "Campañas",
  campaignRecipients: "Destinatarios de campaña",
  templates: "Plantillas",
  leadScores: "Leads calificados",
  leadSheetSources: "Fuentes de leads (Sheets)",
  leadSheetImportedRows: "Filas importadas de Sheets",
  notes: "Notas de contacto",
  aiUsage: "Uso y costos de IA",
};

export function isExportEntityKey(value: string): value is ExportEntityKey {
  return (EXPORT_ENTITIES as readonly string[]).includes(value);
}
