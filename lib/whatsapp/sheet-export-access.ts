import type { SheetExportDataset } from "./export-columns";

// Qué roles pueden crear/usar cada dataset de exportación — espejo deliberado
// de restricciones que YA existen en la app, para no abrir un atajo nuevo:
// - CAMPAIGN_RESULTS: EXECUTIVE_BLOCKED en proxy.ts bloquea /whatsapp/campanas
//   para "ejecutivo", y desde 2026-07 todos los handlers bajo
//   app/api/whatsapp/campaigns/** y lead-sheet-sources/** también devuelven
//   403 para "ejecutivo" directamente en la API (ya no dependen solo de
//   getUserAccountIds) — este gate de dataset es un segundo espejo, no el
//   único lugar que cierra el hueco.
// - CONTACTS: espejo del 403 ya existente en GET /api/whatsapp/contacts para
//   "user" (USER_BLOCKED bloquea /whatsapp/contactos).
// null = todos los roles.
export const DATASET_ALLOWED_ROLES: Record<SheetExportDataset, string[] | null> = {
  LEAD_SCORES: null,
  CHATS: null,
  CAMPAIGN_RESULTS: ["admin", "user"],
  CONTACTS: ["admin", "ejecutivo"],
};

export const DATASET_LABELS: Record<SheetExportDataset, string> = {
  LEAD_SCORES: "Leads calificados",
  CAMPAIGN_RESULTS: "Resultados de campaña",
  CHATS: "Chats / conversaciones",
  CONTACTS: "Contactos",
};

export function canUseDataset(role: string | undefined, dataset: SheetExportDataset): boolean {
  const allowed = DATASET_ALLOWED_ROLES[dataset];
  return allowed === null || allowed.includes(role ?? "");
}

export function allowedDatasetsForRole(role: string | undefined): SheetExportDataset[] {
  return (Object.keys(DATASET_ALLOWED_ROLES) as SheetExportDataset[]).filter((d) => canUseDataset(role, d));
}
