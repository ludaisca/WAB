import type { BotTool } from "./run-tool-loop";

export const QUALIFIED_DATA_TOOL_NAME = "registrar_dato_prospecto";

// A diferencia de la tool de precio, esta NO es opt-in por bot — se le da a
// los 12 bots por igual, sin config nueva en la UI. Cada bot tiene su propia
// metodología de sondeo escrita en su systemPrompt (qué preguntar, en qué
// orden); esta tool es agnóstica a eso, solo expone un mecanismo genérico de
// clave/valor para que el propio modelo decida qué vale la pena recordar.
// Un bot cuyo prompt no menciona ningún "sondeo" simplemente nunca la llama —
// no tiene costo ni riesgo dejarla siempre disponible.
const TOOL_DESCRIPTION =
  'Registra un dato que el prospecto acaba de confirmar sobre sí mismo o su necesidad (ej. su nombre, equipo de interés, cantidad, presupuesto, fecha límite, ciudad, si él decide la compra, tipo de institución, etc.), para no perderlo ni volver a preguntarlo en turnos futuros. Llámala INMEDIATAMENTE cada vez que el prospecto te dé un dato así — no esperes a acumular varios en un solo turno. Usa una clave corta y estable en snake_case (ej. "nombre", "especie", "presupuesto", "decisor"): si ya registraste esa clave antes, este llamado actualiza su valor en vez de duplicarlo. Esta acción es COMPLETAMENTE INVISIBLE para el prospecto — es solo tu propia nota interna. NUNCA le digas ni le insinúes que "registraste", "guardaste" o "anotaste" algo (ej. prohibido: "ya registré que..."); simplemente sigue la conversación con tu siguiente pregunta o respuesta normal, como si esta tool no existiera desde el punto de vista del prospecto.';

// El estado se pasa por referencia y se muta in-place — generateBotReply lo
// inicializa con lo ya persistido (WABotConversation.qualifiedData /
// WABotTestConversation.qualifiedData) y, al terminar el loop de tools, lee
// este mismo objeto (ya con lo nuevo de este turno) para devolverlo al
// llamador, que es quien lo persiste de vuelta.
export function buildQualifiedDataTool(qualifiedData: Record<string, string>): BotTool {
  return {
    definition: {
      name: QUALIFIED_DATA_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          clave: {
            type: "string",
            description: 'Nombre corto y estable del dato, en snake_case (ej. "especie", "presupuesto").',
          },
          valor: {
            type: "string",
            description: "Valor del dato tal como lo dio el prospecto, resumido en pocas palabras.",
          },
        },
        required: ["clave", "valor"],
      },
    },
    execute: async (args) => {
      const clave = String(args.clave ?? "").trim();
      const valor = String(args.valor ?? "").trim();
      if (!clave || !valor) {
        return { ok: false, reason: "Falta clave o valor." };
      }
      qualifiedData[clave] = valor;
      return { ok: true };
    },
  };
}
