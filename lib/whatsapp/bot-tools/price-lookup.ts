import type { WABot } from "@prisma/client";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import type { BotTool } from "./run-tool-loop";

export const PRICE_LOOKUP_TOOL_NAME = "consultar_precio_producto";

// Cada elemento de WABot.priceLookupSkus es la línea cruda que escribió el
// admin: "CODIGO | Descripción breve" (la descripción es opcional — sin "|",
// toda la línea es el código).
interface Sku {
  code: string;
  label: string | null;
}

function parseSkuLine(line: string): Sku {
  const sep = line.indexOf("|");
  if (sep === -1) return { code: line.trim(), label: null };
  return { code: line.slice(0, sep).trim(), label: line.slice(sep + 1).trim() || null };
}

function normalize(code: string): string {
  return code.trim().toUpperCase();
}

// Genérico y reusable por cualquier bot — no está atado a un CRM/marca en
// particular. Solo requiere que la API de precios del cliente exponga un GET
// con un query param de búsqueda y devuelva JSON con (al menos) un campo de
// precio de lista y/o uno de promoción. El precio final que ve el modelo
// siempre se calcula server-side (ver fetchProductPrice) en vez de reenviar
// el JSON crudo — así el LLM no puede citar el campo equivocado ni el más
// bajo de los dos.
export function buildPriceLookupTool(bot: WABot): BotTool | null {
  if (!bot.priceLookupEnabled || !bot.priceLookupUrl) return null;

  const skus = bot.priceLookupSkus.map(parseSkuLine).filter((s) => s.code);

  // Con una lista curada, se la damos al modelo directo en la descripción —
  // ya no necesita inferir el código vía RAG, y la ejecución (abajo) rechaza
  // cualquier código fuera de esta lista antes de tocar la red. Sin lista
  // (bot recién activado, sin curar todavía) el comportamiento es el
  // original: cualquier código que el modelo crea saber, sin restricción.
  const priceInstruction =
    "El resultado trae un único campo `precioApartirDe` ya calculado — comunícalo SIEMPRE como \"a partir de $<precioApartirDe>\" (nunca como precio fijo ni exacto, y nunca menciones que hay más de un precio o promoción de por medio).";

  const description = skus.length
    ? `Consulta el precio y disponibilidad REALES y actuales de uno de estos productos, usando su código EXACTO tal como aparece aquí (no inventes ni adivines otro código):\n${skus
        .map((s) => (s.label ? `- ${s.code}: ${s.label}` : `- ${s.code}`))
        .join("\n")}\nSi el cliente pregunta por algo que no está en esta lista, NO inventes un precio: dile que no lo manejas o que lo vas a confirmar.\n${priceInstruction}`
    : `Consulta el precio y disponibilidad REALES y actuales de un producto por su código exacto (NO por nombre, marca ni descripción libre — solo el código tal como aparece en el catálogo, ej. 'EBIT50-1'). Úsala siempre que el cliente pregunte un precio y conozcas el código por la base de conocimiento. Si no conoces el código exacto, NO inventes un precio: dile al cliente que lo vas a confirmar.\n${priceInstruction}`;

  return {
    definition: {
      name: PRICE_LOOKUP_TOOL_NAME,
      description,
      parameters: {
        type: "object",
        properties: {
          codigoProducto: {
            type: "string",
            description: skus.length
              ? "Uno de los códigos exactos listados arriba"
              : "Código exacto o parcial del producto tal como aparece en el catálogo",
          },
        },
        required: ["codigoProducto"],
      },
    },
    execute: (args) => fetchProductPrice(bot, skus, String(args.codigoProducto ?? "")),
  };
}

async function fetchProductPrice(bot: WABot, skus: Sku[], keywords: string): Promise<unknown> {
  if (!keywords.trim()) {
    return { found: false, reason: "Falta el código de producto." };
  }

  // Lista curada presente: solo se permite consultar un código de la lista —
  // nunca se le pega a la API externa con algo fuera de lo que el admin
  // aprobó, y el modelo recibe la lista real para poder corregirse.
  if (skus.length > 0 && !skus.some((s) => normalize(s.code) === normalize(keywords))) {
    return {
      found: false,
      reason: `Código no reconocido. Códigos disponibles: ${skus.map((s) => s.code).join(", ")}`,
    };
  }

  const url = new URL(bot.priceLookupUrl!);
  url.searchParams.set(bot.priceLookupParam || "keywords", keywords);
  const finalUrl = bot.priceLookupExtraQuery ? `${url.toString()}&${bot.priceLookupExtraQuery}` : url.toString();

  try {
    const res = await fetchWithTimeout(finalUrl, 8000);
    if (res.status === 404) {
      return { found: false, reason: "No se encontró ningún producto con ese código." };
    }
    if (!res.ok) {
      return { found: false, reason: `La API de precios respondió con error (HTTP ${res.status}).` };
    }
    const data = await res.json();

    // La API separa "callamount" (precio de lista) de "promotionprice" (precio
    // en promo) — algunos productos solo traen uno de los dos, y ninguno de
    // los dos es consistentemente "el más caro". Regla del negocio: cotizar
    // siempre el más alto de los dos como "a partir de $X". Se calcula acá y
    // no se le pasa el JSON crudo al modelo para que no tenga oportunidad de
    // confundir/mezclar los dos campos o citar el más bajo.
    const priceCandidates = [data?.callamount, data?.promotionprice].filter(
      (p): p is number => typeof p === "number" && p > 0
    );
    if (priceCandidates.length === 0) {
      return {
        found: false,
        reason: "El producto existe pero no tiene un precio configurado en el sistema — no inventes un precio, dile al cliente que lo vas a confirmar.",
      };
    }

    return {
      found: true,
      product: {
        name: data?.name ?? null,
        code: data?.code ?? null,
        brand: data?.brand ?? null,
        stock: data?.stock ?? null,
      },
      precioApartirDe: Math.max(...priceCandidates),
    };
  } catch {
    // Nunca lanza hacia el loop de tools — un timeout/error de red en una API
    // de un tercero no debe tumbar el turno completo del bot.
    return { found: false, reason: "No se pudo consultar el precio en este momento (timeout o error de red)." };
  }
}
