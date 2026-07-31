// No hay ningún AbortController/timeout de fetch establecido en el repo hoy —
// toda integración HTTP existente (lib/whatsapp.ts, Graph API) confía en que
// el otro lado responda. Una API de un tercero (ej. el CRM de precios de un
// cliente) puede simplemente no responder, y sin timeout eso colgaría el turno
// del bot indefinidamente en vez de caer a un fallback seguro.
export async function fetchWithTimeout(url: string, timeoutMs = 8000, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
