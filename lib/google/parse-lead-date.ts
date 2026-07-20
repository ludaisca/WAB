/**
 * Interpreta la fecha de registro de un lead tal como viene en la hoja.
 *
 * Deliberadamente NO resuelve formatos ambiguos: "07/03/2026" puede ser el 7 de
 * marzo o el 3 de julio según quién exportó la hoja, y mostrar la lectura
 * equivocada es peor que no mostrar ninguna — el usuario decidiría a quién
 * recontactar con una fecha falsa. Por eso el texto original siempre se conserva
 * y se muestra tal cual; el DateTime solo se rellena cuando el formato no admite
 * dos lecturas, y sirve para ordenar/filtrar, no para reemplazar lo que el
 * usuario ve.
 *
 * Formatos considerados inequívocos:
 *  - ISO 8601 — incluido el `created_time` de Meta Lead Ads ("2026-07-20T12:25:14+0000")
 *  - `YYYY-MM-DD` con hora opcional (el orden año-mes-día no admite otra lectura)
 */
export function parseLeadDate(raw: string | null | undefined): { raw: string | null; date: Date | null } {
  const text = raw?.trim();
  if (!text) return { raw: null, date: null };

  // Ancla en año de 4 dígitos al inicio: descarta dd/mm/yyyy y mm/dd/yyyy, que
  // son justo los que no se pueden distinguir entre sí.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(text)) {
    const parsed = new Date(text.replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) return { raw: text, date: parsed };
  }

  return { raw: text, date: null };
}
