// Minimal RFC4180-ish CSV parser (quoted fields, escaped "" quotes) — no external
// dependency needed for the small phone/name/param files campaigns import.

const PHONE_HEADERS = ["telefono", "teléfono", "phone", "numero", "número", "whatsapp"];
const NAME_HEADERS = ["nombre", "name", "contacto"];

export interface ParsedCsvRow {
  id: string;
  phoneNumber: string;
  contactName: string;
  params: string[];
}

export interface ParsedCsv {
  rows: ParsedCsvRow[];
  paramColumnCount: number;
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

export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], paramColumnCount: 0 };

  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.includes(h));
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));
  const resolvedPhoneIdx = phoneIdx === -1 ? 0 : phoneIdx;
  const paramIndexes = header
    .map((_, i) => i)
    .filter((i) => i !== resolvedPhoneIdx && i !== nameIdx);

  const rows: ParsedCsvRow[] = lines.slice(1).map((line, idx) => {
    const cells = parseLine(line);
    return {
      id: `csv-${idx}`,
      phoneNumber: (cells[resolvedPhoneIdx] ?? "").replace(/\D/g, ""),
      contactName: nameIdx !== -1 ? cells[nameIdx] ?? "" : "",
      params: paramIndexes.map((i) => cells[i] ?? ""),
    };
  }).filter((r) => r.phoneNumber);

  return { rows, paramColumnCount: paramIndexes.length };
}
