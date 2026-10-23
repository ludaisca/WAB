// Estos marcadores no forman parte de una respuesta al prospecto. Se bloquea
// el turno completo: recortar hasta el saludo podría dejar pasar instrucciones
// internas sin marcador o aparentar que una herramienta sí se ejecutó.
const INTERNAL_CONTENT = /\btool_code\b|\bdefault_api\s*\.|<\/?(?:think(?:ing)?|thought|analysis|function_calls?|tool_calls?|function_response)\b|(?:^|\n)\s*(?:```\s*)?(?:thought|analysis|reasoning)\s*(?::|\r?\n|$)|\[(?:thought|analysis|reasoning)\]/i;
const BOT_TOOL_NAMES = ["registrar_dato_prospecto", "consultar_precio_producto"];

export const SAFE_BOT_REPLY =
  "Disculpa, tuve un problema al responder. ¿Me repites tu último mensaje?";

export const BOT_REPLY_INSTRUCTIONS =
  "Tu respuesta de texto se envía directamente al prospecto. Escribe únicamente el mensaje para él, sin razonamiento, análisis, etiquetas thought/tool_code, código ni nombres de herramientas. Para registrar datos o consultar precios usa exclusivamente las llamadas estructuradas de herramientas (functionCall) de la API; nunca escribas ni simules esas llamadas en el texto.";

export const BOT_REPLY_REPAIR_INSTRUCTIONS =
  "La respuesta anterior no pudo utilizarse. Vuelve a responder al último mensaje del prospecto sin repetir contenido interno. Si necesitas guardar un dato, haz una llamada estructurada a la herramienta disponible antes de responder; escribir código no ejecuta ninguna acción. No repitas herramientas que ya se ejecutaron correctamente en este turno. Si las herramientas están deshabilitadas, devuelve únicamente una respuesta breve para el prospecto sin afirmar que guardaste datos nuevos.";

export function containsInternalBotContent(text: string, toolNames: string[] = []): boolean {
  const normalized = text.toLowerCase();
  return INTERNAL_CONTENT.test(text) || [...BOT_TOOL_NAMES, ...toolNames].some(
    (name) => name.length > 0 && normalized.includes(name.toLowerCase())
  );
}
