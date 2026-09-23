// Tarifa oficial de Meta por mensaje de plantilla entregado, por país +
// categoría (MARKETING/UTILITY/AUTHENTICATION). Verificada por el usuario en
// WhatsApp Manager el 2026-09-23 — los blogs de terceros no coinciden entre
// sí, así que este número viene directo de la fuente, no de una búsqueda.
// Meta actualiza estas tarifas trimestralmente — revisar si el gasto
// calculado empieza a divergir de la factura real de Meta.
const MESSAGE_PRICING: Record<string, Record<string, number>> = {
  MX: { MARKETING: 0.0305 },
};

// País detectado por el prefijo de código de país en los dígitos del
// teléfono — no hay normalización de número en el resto del código (ver
// lib/whatsapp/send-template.ts), así que `phoneNumber` llega tal cual lo
// mandó el usuario/CSV, con código de país al frente y sin "+".
function detectCountry(phoneDigits: string): string | null {
  if (phoneDigits.startsWith("52")) return "MX";
  return null;
}

// Costo estimado de un mensaje de campaña — null cuando el país/categoría no
// está en la tabla (en vez de $0, que implicaría "gratis"). Mirror del
// patrón de lib/ai/pricing.ts: tabla estática hand-maintained + console.warn
// visible en logs en vez de fallar o quedar en silencio.
export function estimateMessageCostUsd(
  phoneNumber: string,
  templateCategory: string
): number | null {
  const digits = phoneNumber.replace(/\D/g, "");
  const country = detectCountry(digits);
  const category = templateCategory.toUpperCase();
  const price = country ? MESSAGE_PRICING[country]?.[category] : undefined;

  if (price === undefined) {
    console.warn(
      `[campaign-pricing] Sin tarifa conocida para país/categoría de "${phoneNumber}"/"${templateCategory}" — costo no calculado`
    );
    return null;
  }

  return price;
}
