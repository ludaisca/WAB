import type { sheets_v4 } from "googleapis";

export interface SheetTab {
  title: string;
  sheetId: number;
}

export async function listSheetTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<SheetTab[]> {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  return (data.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? "", sheetId: s.properties?.sheetId ?? 0 }))
    .filter((t) => t.title);
}

// Rango fijo y generoso (mismo criterio que writeSheetTab en sheets-sync.ts) — una
// sola llamada trae toda la pestaña sin necesitar saber de antemano cuántas filas tiene.
export async function readSheetValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string
): Promise<string[][]> {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A1:Z100000`,
  });
  return (data.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
}

// Acepta tanto una URL completa de Google Sheets como un ID crudo, pegado por el
// usuario en el formulario de alta de una fuente de leads.
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
  return null;
}
