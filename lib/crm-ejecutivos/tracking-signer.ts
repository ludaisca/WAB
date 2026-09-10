// Heurística para detectar cuando un seguimiento (ExternalProspect.trackings)
// fue firmado por alguien distinto al ejecutivo actualmente asignado en WAB.
// Limenka no expone ningún campo de autoría en /agents/get-trackings — cada
// entrada solo trae {id, status, reason, observations, createdAt, action}
// (ver el comentario de RawTracking en client.ts) — así que la única señal
// disponible es la autopresentación que algunas plantillas de WhatsApp usan
// ("Soy el/la <nombre>"). Confirmado contra datos reales (2026-09, auditoría
// completa de los 2 ejecutivos monitoreados): de 146 leads con historial,
// solo 2 mostraron un firmante ajeno — un envío masivo puntual de un tercero
// ("Marlon Luna", mismo mensaje a 2 leads con 12s de diferencia), no una
// fuga sistémica de datos entre ejecutivos (get-trackings sí filtra por
// acceso al lead, confirmado por prueba manual — ver la nota en client.ts).
//
// Deliberadamente conservador: si no hay firma reconocible en absoluto (la
// plantilla de Barbara, por ejemplo, no usa "Soy el/la...") esta función NO
// marca nada — ausencia de firma no es evidencia de "otro agente", solo
// evidencia de que este patrón no aplica a ese mensaje.
const SIGNER_RE = /[Ss]oy\s+(?:el|la)\s+(?:Lic\.?|Ing\.?|Dr\.?|Dra\.?|Mvz\.?)?\s*(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){1,3})/u;

function normalizeWords(s: string): Set<string> {
  const normalized = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return new Set(normalized.split(/\s+/).filter((w) => w.length >= 3));
}

/**
 * Devuelve el nombre firmante detectado en `observations` cuando NO
 * comparte ninguna palabra (≥3 letras, sin acentos) con el nombre del
 * ejecutivo asignado (`TrackedExecutive.label`) — o `null` si no hay firma
 * reconocible, o si la firma sí coincide con el ejecutivo asignado.
 */
export function detectForeignSigner(observations: string | null | undefined, executiveLabel: string): string | null {
  if (!observations) return null;
  const match = SIGNER_RE.exec(observations);
  if (!match) return null;

  const signer = match[1].trim();
  const signerWords = normalizeWords(signer);
  const ownWords = normalizeWords(executiveLabel);
  const overlaps = [...signerWords].some((w) => ownWords.has(w));
  return overlaps ? null : signer;
}
