import type ExcelJS from "exceljs";
import type { ExportColumnDef } from "@/lib/whatsapp/export-columns";

// Extiende ExportColumnDef<T> (lib/whatsapp/export-columns.ts, get: T=>string)
// sin tocar ese archivo — get: T=>string|number|null permite columnas
// numéricas reales (costo, tokens, conteos) en vez de todo-texto. Como
// ExportColumnDef<T> es estructuralmente compatible con ReportColumnDef<T>,
// los 4 arrays ya existentes (EXPORT_COLUMNS, CAMPAIGN_EXPORT_COLUMNS,
// CHATS_EXPORT_COLUMNS, CONTACTS_EXPORT_COLUMNS) se pasan a addColumnarSheet
// sin ningún adaptador.
export interface ReportColumnDef<T> {
  key: string;
  label: string;
  width?: number;
  numFmt?: string;
  get: (row: T) => string | number | null;
}

export const MONEY_FMT = "$#,##0.0000";
export const INT_FMT = "#,##0";

// Nombre de pestaña Excel: máx 31 caracteres, sin \ / ? * [ ] :
export function addColumnarSheet<T>(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  columns: (ReportColumnDef<T> | ExportColumnDef<T>)[],
  rows: T[]
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => {
    const rc = c as ReportColumnDef<T>;
    return {
      header: c.label,
      key: c.key,
      width: rc.width ?? Math.min(Math.max(c.label.length + 4, 12), 40),
      style: rc.numFmt ? { numFmt: rc.numFmt } : undefined,
    };
  });
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, c.get(row)])));
  }
  sheet.getRow(1).font = { bold: true };
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
}
