import type { sheets_v4 } from "googleapis";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";

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

// Resuelve una URL/ID pegada por el usuario a sus pestañas reales — extraída de
// app/api/whatsapp/lead-sheet-sources/preview/route.ts (mismos mensajes de
// error) para que esa ruta y app/api/whatsapp/sheet-exports/preview/route.ts
// compartan la misma lógica en vez de duplicarla. Lanza Error en vez de
// devolver NextResponse — cada caller la envuelve en su propio try/catch.
export async function resolveSpreadsheetTabs(
  userId: string,
  spreadsheetIdOrUrl: string
): Promise<{ spreadsheetId: string; tabs: SheetTab[] }> {
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  if (!spreadsheetId) {
    throw new Error("No se pudo identificar el ID de la hoja");
  }

  const sheets = await getGoogleSheetsClientForUser(userId);
  if (!sheets) {
    throw new Error("Conecta tu cuenta de Google en Configuración antes de continuar");
  }

  const tabs = await listSheetTabs(sheets, spreadsheetId);
  if (tabs.length === 0) {
    throw new Error("No se encontraron pestañas en esa hoja");
  }

  return { spreadsheetId, tabs };
}
