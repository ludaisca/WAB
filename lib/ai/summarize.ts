// Compresión simple de memoria conversacional tipo "resumen corriendo" —
// compartida por bot-worker.ts (pipeline automático) y unassigned-lead-reply.ts
// (respuesta manual sin bot activo) para que un bot con memoryType:"SUMMARY"
// se comporte igual sin importar qué flujo generó la respuesta.
export function summarizeText(newMessage: string, existingSummary: string | null): string {
  const combined = existingSummary ? `${existingSummary}\n\n---\n\n${newMessage}` : newMessage;

  if (combined.length > 2000) {
    return combined.slice(combined.length - 2000);
  }

  return combined;
}
