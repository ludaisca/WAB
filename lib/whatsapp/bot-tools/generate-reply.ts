import type { WABot } from "@prisma/client";
import { getAIProvider } from "@/lib/ai/factory";
import { searchKnowledge } from "@/lib/ai/rag";
import { wrapUserPrompt, SCOPE_GUARDRAIL } from "@/lib/ai/prompt-sanitizer";
import { buildPriceLookupTool, PRICE_LOOKUP_TOOL_NAME } from "./price-lookup";
import { buildQualifiedDataTool } from "./qualified-data";
import { completeWithBotTools, type BotTool } from "./run-tool-loop";
import type { AIMessage, ContentPart } from "@/lib/ai/types";

// Backstop contra alucinación de precios: ningún bot puede enviar un precio en
// un turno sin ningún dato real que lo respalde (RAG apagado/sin resultados, y
// sin una consulta en vivo exitosa a la tool de precio — ver knowledgeInjected/
// priceToolUsed en generateBotReply). Verificado en vivo que el prompt por sí
// solo no es confiable: gemini-2.5-flash-lite inventó un precio y modelo de
// equipo pese a una instrucción explícita de "solo si aparece en la base de
// conocimiento" bajo presión de insistencia del lead.
// Heurística deliberadamente simple — puede bloquear un falso positivo
// legítimo (ej. el bot repite un precio que un agente humano ya dio antes en
// el historial, o menciona una cantidad no monetaria cerca de una palabra de
// precio), pero prioriza nunca dejar pasar un precio inventado sobre nunca
// bloquear uno real. Cuatro alternativas: símbolo de moneda + dígito, dígitos
// + palabra de moneda, y dos más (agregadas 2026-07-31) para el caso de un
// precio en números sueltos sin moneda explícita pegada (ej. "cuesta 15000,
// contáctanos para más detalles") — una palabra de precio seguida de un
// número, o un número seguido de una palabra de precio, dentro de una
// ventana corta (≈20 caracteres, sin cruzar fin de oración) en cualquiera de
// los dos órdenes.
const PRICE_WORD = "(?:cuesta|vale|precio\\w*|cotiza\\w*|sale en|desde)";
const PRICE_PATTERN = new RegExp(
  `\\$\\s?\\d[\\d.,]*` +
    `|\\b\\d[\\d.,]{2,}\\s?(pesos|mxn|usd|d[oó]lares)\\b` +
    `|\\b${PRICE_WORD}\\b[^.\\n$]{0,20}\\d[\\d.,]{2,}` +
    `|\\d[\\d.,]{2,}[^.\\n$]{0,20}\\b${PRICE_WORD}\\b`,
  "i"
);
const UNGROUNDED_PRICE_FALLBACK =
  "Ese precio en particular lo tengo que confirmar con el equipo para no darte un dato equivocado — dame un momento y te lo confirmo, o si prefieres que te contacte un especialista ahora mismo, dímelo.";

function containsUngroundedPrice(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

// Verificado en vivo (auditoría de conversaciones reales, 2026-07-31): el
// mismo SKU cotizó precios distintos e incompatibles entre chats de un mismo
// bot con RAG activo — el chequeo original solo exige que *algún* contexto de
// RAG/tool haya entrado a la llamada, no que la cifra concreta que el modelo
// dijo de verdad venga de ahí. Un chunk de RAG semánticamente relacionado
// pero irrelevante al precio exacto (u otro producto) hace que
// knowledgeInjected sea true igual, dejando pasar un número fabricado. Esta
// función exige, además, que el número que aparece en la respuesta también
// aparezca (normalizado) en el texto fundamentado del turno — mismo principio
// que containsUngroundedUrl ya aplica a links, ahora extendido a precios.
// Normaliza ".00"/",00" antes de despojar separadores para que "$159,000.00"
// y "159000" cuenten como el mismo número — puede fallar en el caso raro de
// un precio con centavos reales, pero ante la duda prioriza bloquear (mismo
// criterio ya documentado arriba para el resto de este archivo).
function normalizePriceDigits(raw: string): string {
  return raw.replace(/[.,]00$/, "").replace(/[^\d]/g, "");
}

// Cifras explícitamente etiquetadas con símbolo/palabra de moneda — a
// diferencia de la extracción laxa de abajo (cualquier \d[\d.,]{2,} suelto en
// el mensaje), esto aísla específicamente cuáles números SON un precio, sin
// arrastrar cantidades, folios o fechas que puedan aparecer en el mismo texto.
const TAGGED_PRICE_NUMBER = /\$\s?(\d[\d.,]*)|(\d[\d.,]{2,})\s?(?:pesos|mxn|usd|d[oó]lares)\b/gi;

function extractTaggedPriceNumbers(text: string): string[] {
  return [...text.matchAll(TAGGED_PRICE_NUMBER)].map((m) => m[1] ?? m[2]);
}

// Actualizado 2026-08-04: el chequeo original exigía que bastara con que
// ALGUNA cifra del mensaje coincidiera con el contexto fundamentado ("some")
// — eso deja pasar un mensaje que mezcla un precio real recién confirmado por
// la tool con una segunda cifra fabricada por el propio modelo, ej. una
// conversión de moneda hecha a mano ("$1,250 USD... en pesos serían $21,875
// MXN") que nunca vino de la tool ni del RAG. Cuando el mensaje trae al menos
// una cifra explícitamente etiquetada con moneda, ahora TODAS esas cifras
// etiquetadas deben estar fundamentadas ("every"), no solo una — así una
// conversión inventada bloquea el mensaje completo aunque venga acompañado de
// un precio real y legítimo. Para el patrón laxo (precio-palabra cerca de un
// número sin moneda pegada, ej. "cuesta 15000") no hay forma confiable de
// aislar cuál número es el precio, así que ese caso conserva el chequeo laxo
// original (basta una coincidencia).
function priceIsGroundedInContext(text: string, groundedContext: string): boolean {
  const groundedDigits = new Set((groundedContext.match(/\d[\d.,]{2,}/g) ?? []).map(normalizePriceDigits));

  const tagged = extractTaggedPriceNumbers(text);
  if (tagged.length > 0) {
    return tagged.every((q) => groundedDigits.has(normalizePriceDigits(q)));
  }

  const quoted = text.match(/\d[\d.,]{2,}/g);
  if (!quoted) return true; // sin cifra numérica que verificar (ej. solo disparó por palabra de moneda)
  return quoted.some((q) => groundedDigits.has(normalizePriceDigits(q)));
}

// Mismo backstop que el de precios, pero para links (verificado en vivo: bajo
// insistencia el bot también llegó a inventar un link de YouTube que no existe).
// A diferencia del precio (heurística de patrón, sin forma de verificar si es
// "real"), un link sí se puede verificar literal: si la URL no aparece tal cual
// en ninguna fuente fundamentada de este turno (el propio systemPrompt del bot,
// el contexto RAG inyectado, o el resultado de una tool real), es indistinguible
// de una inventada. Deliberadamente NO se intenta un regex equivalente para
// "modelos de producto" inventados — el formato es demasiado libre para un
// patrón confiable; se mitiga indirectamente con RAG bien poblado y la tool de
// precio por código.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const UNGROUNDED_LINK_FALLBACK =
  "Ese enlace lo tengo que confirmar antes de compartirlo para no mandarte uno equivocado — dame un momento, o si prefieres que te contacte un especialista ahora mismo, dímelo.";

// Verificado en vivo (bot "Ultrasonidos Veterinarios - Leads", conversación de
// prueba 2026-07-30): en la última vuelta del loop de tools (forceFinal=true,
// tools deshabilitadas) el modelo puede devolver `content: ""` en vez de una
// respuesta de texto — sucede cuando, en las vueltas anteriores, el modelo
// venía intentando resolver qué tool llamar (ej. no sabía qué SKU exacto de
// los 3 disponibles corresponde a "lo más barato") y llega a la vuelta forzada
// sin haber decidido un texto final. Sin este backstop, ese "" se guardaba y
// mostraba tal cual (burbuja vacía) tanto en el panel de prueba como, en
// producción, se habría enviado a Meta como un mensaje vacío (rechazado por la
// API, dejando al lead sin respuesta hasta el fallback de reintento).
const EMPTY_REPLY_FALLBACK =
  "Dame un momento para confirmar bien ese dato — ¿te parece si mejor te contacto por aquí en cuanto lo tenga?";

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function containsUngroundedUrl(text: string, groundedContext: string): boolean {
  const urls = text.match(URL_PATTERN);
  if (!urls) return false;
  const haystack = groundedContext.toLowerCase();
  return urls.some((raw) => {
    const url = raw.replace(/[.,;:)\]'"]+$/, "");
    return !haystack.includes(url.toLowerCase());
  });
}

// Verificado en vivo (auditoría de conversaciones reales, 2026-07-31): al
// menos 3 bots distintos enviaron literal a un lead un placeholder de
// plantilla sin rellenar — "[mencionar aplicación clínica principal]", "[Tu
// Nombre]", "[Número de teléfono del especialista]" — probablemente porque
// algún few-shot o instrucción de ejemplo en el prompt usa corchetes como
// notación de "rellena aquí" y el modelo la reproduce tal cual en vez de
// completarla. En una conversación de WhatsApp en español, texto entre
// corchetes prácticamente nunca es legítimo (no hay citas ni notas al pie),
// así que el riesgo de falso positivo es mínimo — se bloquea sin condición,
// a diferencia de precio/link que sí dependen de si hay contexto fundamentado.
const PLACEHOLDER_PATTERN = /\[[^[\]\n]{3,80}\]/;
const PLACEHOLDER_FALLBACK =
  "Dame un momento para confirmarte ese dato correctamente — en cuanto lo tenga te lo paso.";

function containsUnfilledPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERN.test(text);
}

export interface GenerateBotReplyParams {
  bot: WABot;
  apiKey: string;
  // Texto usado para buscar en la base de conocimiento cuando bot.ragEnabled.
  ragQuery: string;
  // Notas de contexto adicionales (ej. de qué campaña viene el chat, resumen
  // de memoria acumulado) — cada una se agrega como su propio mensaje system,
  // después del contexto RAG y antes del historial. Vacío en conversaciones
  // de prueba, que no tienen campaña ni resumen.
  extraSystemNotes?: string[];
  // Turnos previos (user/assistant), en orden cronológico, sin incluir el
  // turno nuevo — cada llamador decide cómo resolvió ese historial (WAMessage
  // real vs. WABotTestMessage de una conversación de prueba).
  history: AIMessage[];
  userContent: string | ContentPart[];
  // Datos de sondeo ya confirmados en turnos anteriores de esta conversación
  // (WABotConversation.qualifiedData / WABotTestConversation.qualifiedData) —
  // null/undefined en el primer turno o si el llamador todavía no persiste
  // esto. Se inyecta como system note y se le da al modelo la tool para
  // seguir completándolo — ver qualified-data.ts.
  qualifiedData?: Record<string, string> | null;
}

export interface GenerateBotReplyResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  knowledgeInjected: boolean;
  priceToolUsed: boolean;
  // qualifiedData de entrada, mergeado con cualquier dato nuevo que el bot
  // haya registrado en este turno — el llamador debe persistirlo de vuelta en
  // la conversación (reemplazando el valor anterior, no solo cuando cambia,
  // así el update es idempotente).
  qualifiedData: Record<string, string>;
}

// Único lugar donde se arma el turno completo de un bot: prompt + RAG +
// tool-calling + guardrails de precio/links. Usado tanto por el envío real
// (lib/workers/bot-worker.ts) como por las conversaciones de prueba
// (app/api/whatsapp/bots/[id]/test/conversations/**) — deliberadamente el
// mismo código para los dos, para que "probar" el bot refleje fielmente cómo
// va a responder de verdad a un lead.
export async function generateBotReply(params: GenerateBotReplyParams): Promise<GenerateBotReplyResult> {
  const { bot, apiKey, ragQuery, extraSystemNotes = [], history, userContent } = params;

  // Copia local mutable — la tool de sondeo escribe acá directo durante el
  // loop (ver qualified-data.ts); al final del turno esta misma referencia,
  // ya actualizada, es lo que se devuelve para que el llamador la persista.
  const qualifiedData: Record<string, string> = { ...(params.qualifiedData ?? {}) };

  const messages: AIMessage[] = [];
  messages.push({ role: "system", content: wrapUserPrompt(bot.systemPrompt) });
  messages.push({ role: "system", content: SCOPE_GUARDRAIL });

  if (Object.keys(qualifiedData).length > 0) {
    const lines = Object.entries(qualifiedData)
      .map(([clave, valor]) => `- ${clave}: ${valor}`)
      .join("\n");
    messages.push({
      role: "system",
      content: `Datos ya confirmados de este prospecto en turnos anteriores (no los vuelvas a preguntar salvo que necesites confirmarlos de nuevo):\n${lines}`,
    });
  }

  // Cuenta objetiva de respuestas propias ya dadas en la conversación —
  // complementa qualifiedData para condiciones tipo "revela el precio solo
  // después de tu 2da respuesta", que de otro modo el modelo autoevalúa de
  // forma poco confiable repasando el historial crudo.
  const botReplyCount = history.filter((m) => m.role === "assistant").length;
  messages.push({
    role: "system",
    content: `Llevas ${botReplyCount} respuesta(s) tuya(s) en esta conversación hasta ahora (sin contar la que estás por dar). Esto es solo para tu propio criterio interno — nunca lo menciones, cites ni parafrasees al prospecto (ej. prohibido decir "llevamos N intercambios" o "ya van varias respuestas").`,
  });

  // Recordatorio genérico (no depende del systemPrompt de cada bot, así que
  // aplica igual a los 12 sin tocar su copy de ventas): la sola descripción
  // de la tool en su definición no bastaba para que el modelo la llamara de
  // forma consistente turno a turno — verificado en vivo, algunas corridas la
  // ignoraron por completo pese a que el prospecto sí dio datos nuevos.
  messages.push({
    role: "system",
    content:
      "Si el prospecto te acaba de dar algún dato de sondeo o calificación nuevo o distinto al de arriba (nombre, interés, cantidad, presupuesto, fecha, ciudad, tipo de institución, quién decide, etc.), usa la tool registrar_dato_prospecto para guardarlo antes de responder — no lo dejes solo en tu respuesta de texto.",
  });

  let knowledgeInjected = false;
  // Fuentes de verdad de este turno, para el guardrail de links — un link
  // presente acá no se bloquea aunque el resto del mensaje sea nuevo.
  const groundingSources: string[] = [bot.systemPrompt];

  if (bot.ragEnabled) {
    // La embedding de la búsqueda no puede ser solo el último mensaje: un
    // follow-up corto y genérico ("¿o qué modelos manejas?") no trae
    // suficiente señal semántica propia, aunque el tema ya esté establecido
    // varios turnos atrás en la conversación (ej. "¿manejan máquinas de
    // anestesia?"). Verificado en vivo: sin este contexto, esa pregunta no
    // superaba el umbral de similitud pese a existir conocimiento relevante
    // indexado, y el bot terminaba dando una respuesta evasiva. Se antepone
    // una ventana corta del historial reciente (texto plano únicamente) para
    // anclar la búsqueda al tema de la conversación sin diluirla con turnos
    // muy viejos.
    const recentContext = history
      .slice(-6)
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n");
    const contextualRagQuery = recentContext ? `${recentContext}\n${ragQuery}` : ragQuery;

    const knowledge = await searchKnowledge(bot.id, contextualRagQuery, apiKey);
    if (knowledge) {
      messages.push({
        role: "system",
        content: `Información relevante de la base de conocimiento:\n\n${knowledge}`,
      });
      knowledgeInjected = true;
      groundingSources.push(knowledge);
    }
  }

  for (const note of extraSystemNotes) {
    messages.push({ role: "system", content: note });
  }

  messages.push(...history);
  messages.push({ role: "user", content: userContent });

  const client = getAIProvider(apiKey);
  const tools: BotTool[] = [buildPriceLookupTool(bot), buildQualifiedDataTool(qualifiedData)].filter(
    (t): t is BotTool => t !== null
  );
  const loopResult = await completeWithBotTools(client, {
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
    tools,
  });

  let content = loopResult.content;
  groundingSources.push(...loopResult.toolResultTexts);

  // Un precio real ya no es "sin respaldo" si vino de una consulta en vivo
  // exitosa a la tool de precio — solo el fallback de RAG cuenta como
  // fundamento en el chequeo original; esto evita que el guardrail bloquee un
  // precio verdadero que el propio bot acaba de consultar.
  const priceToolUsed = loopResult.toolCallLog.some(
    (call) => call.name === PRICE_LOOKUP_TOOL_NAME && (call.result as { found?: boolean } | null)?.found === true
  );

  if (isBlank(content)) {
    console.warn(`[generate-reply] Respuesta vacía del modelo — bot "${bot.name}"`);
    content = EMPTY_REPLY_FALLBACK;
  }

  if (containsUnfilledPlaceholder(content)) {
    console.warn(`[generate-reply] Placeholder de plantilla sin rellenar bloqueado — bot "${bot.name}"`);
    content = PLACEHOLDER_FALLBACK;
  }

  const groundedContext = groundingSources.join("\n");
  const hasGroundingContext = knowledgeInjected || priceToolUsed;

  if (
    containsUngroundedPrice(content) &&
    (!hasGroundingContext || !priceIsGroundedInContext(content, groundedContext))
  ) {
    console.warn(`[generate-reply] Precio sin respaldo bloqueado — bot "${bot.name}"`);
    content = UNGROUNDED_PRICE_FALLBACK;
  }

  if (containsUngroundedUrl(content, groundedContext)) {
    console.warn(`[generate-reply] Link sin respaldo bloqueado — bot "${bot.name}"`);
    content = UNGROUNDED_LINK_FALLBACK;
  }

  return { content, usage: loopResult.totalUsage, knowledgeInjected, priceToolUsed, qualifiedData };
}
