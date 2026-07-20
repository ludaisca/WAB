function escapeCsvField(value: string): string {
  // Neutraliza inyección de fórmulas (CSV injection): Excel/Sheets interpretan un
  // campo que empieza con = + - @ (o tab/CR) como fórmula ejecutable. Como los
  // nombres/valores vienen del perfil de WhatsApp del lead (input no confiable),
  // se antepone un apóstrofo para forzar que se traten como texto literal.
  let safe = value;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\r\n");
}

// UTF-8 BOM so Excel/Google Sheets' "Importar archivo" correctly detects
// accented characters (á, é, ñ...) instead of showing mojibake.
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
