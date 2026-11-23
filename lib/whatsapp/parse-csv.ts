// Minimal RFC4180-ish CSV parser (quoted fields, escaped "" quotes) — no external
// dependency needed for the phone/name/param files campaigns import. The file is
// read as a raw table first; which column feeds the phone, the contact name and
// each template variable is a separate, user-confirmed mapping.

const PHONE_HEADERS = ["telefono", "teléfono", "phone", "numero", "número", "whatsapp"];
const NAME_HEADERS = ["nombre", "name", "contacto"];

export interface ParsedCsvRow {
  id: string;
  phoneNumber: string;
  contactName: string;
  params: string[];
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/**
 * Qué columna del archivo alimenta cada dato del destinatario. `params[i]` es la
 * columna para la variable i+1 del cuerpo (o la i-ésima variable con nombre);
 * `null` = sin asignar. Las columnas que no aparecen aquí se ignoran.
 */
export interface CsvColumnMapping {
  phone: number;
  name: number | null;
  params: (number | null)[];
}

/** Lee el CSV completo como tabla cruda (encabezados + celdas), sin interpretar columnas. */
export function parseCsvTable(text: string): CsvTable {
  // Excel guarda "CSV UTF-8" con BOM; sin quitarlo el primer encabezado no coincide.
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function normalizeHeader(h: string): string {
  return h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const PHONE_HINTS = ["tel", "phone", "whatsapp", "celular", "movil", "numero"];

/**
 * Propone un mapeo a partir de los encabezados. Es solo el punto de partida:
 * el usuario lo confirma o corrige en la UI antes de crear la campaña.
 *
 * - Teléfono: encabezado exacto conocido, si no uno que lo sugiera, si no la 1ª columna.
 * - Nombre: solo coincidencia exacta (`nombre`, `name`, `contacto`) — un
 *   `VAR_1_NOMBRE` es una variable, no el nombre del contacto.
 * - Variables: para plantillas con nombre, la columna que se llame igual; para
 *   las posicionales, una columna que diga `var_1`/`variable 1`/`{{1}}`; lo que
 *   quede se llena en orden con las columnas restantes.
 */
export function guessCsvMapping(
  headers: string[],
  paramCount: number,
  paramNames: string[] | null = null
): CsvColumnMapping {
  const norm = headers.map(normalizeHeader);
  const exactPhone = norm.findIndex((h) => PHONE_HEADERS.includes(h));
  const fuzzyPhone = norm.findIndex((h) => PHONE_HINTS.some((hint) => h.includes(hint)));
  const phone = exactPhone !== -1 ? exactPhone : fuzzyPhone !== -1 ? fuzzyPhone : 0;
  const nameIdx = norm.findIndex((h, i) => i !== phone && NAME_HEADERS.includes(h));
  const name = nameIdx === -1 ? null : nameIdx;

  const used = new Set<number>([phone, ...(name !== null ? [name] : [])]);
  const params: (number | null)[] = Array.from({ length: paramCount }, (_, slot) => {
    const target = paramNames?.[slot];
    const idx = target
      ? norm.findIndex((h, i) => !used.has(i) && h === normalizeHeader(target))
      : norm.findIndex((h, i) => !used.has(i) && new RegExp(`(var|variable|param|parametro)[\\s_-]*${slot + 1}(\\D|$)|\\{\\{\\s*${slot + 1}\\s*\\}\\}`).test(h));
    if (idx === -1) return null;
    used.add(idx);
    return idx;
  });

  // Lo que no se pudo emparejar por nombre se llena en orden con las columnas libres.
  const free = norm.map((_, i) => i).filter((i) => !used.has(i));
  return {
    phone,
    name,
    params: params.map((p) => (p !== null ? p : free.shift() ?? null)),
  };
}

/** Convierte la tabla cruda en destinatarios según el mapeo elegido. */
export function applyCsvMapping(table: CsvTable, mapping: CsvColumnMapping): ParsedCsvRow[] {
  return table.rows
    .map((cells, idx) => ({
      id: `csv-${idx}`,
      phoneNumber: (cells[mapping.phone] ?? "").replace(/\D/g, ""),
      contactName: mapping.name !== null ? cells[mapping.name] ?? "" : "",
      params: mapping.params.map((col) => (col !== null ? cells[col] ?? "" : "")),
    }))
    .filter((r) => r.phoneNumber);
}
