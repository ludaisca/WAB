import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adjustBotPromptSchema } from "@/lib/validations";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import type { AIProvider } from "@/lib/ai/types";

// Prompts pegados por el usuario suelen venir de otro sistema (n8n, Make, un
// asistente distinto) y asumen capacidades que este bot no tiene: salida JSON,
// tool-calling explícito, variables de plantilla, estado estructurado entre
// turnos, envío de archivos o reasignación de chat por su cuenta. Estas reglas
// le dicen al modelo qué reescribir para que el prompt resultante funcione tal
// cual con bot-worker.ts (ver AGENTS.md — el bot solo produce texto plano, el
// RAG se inyecta automáticamente antes de la llamada, y no hay function calling).
const ADAPTATION_RULES = `Eres un experto en adaptar prompts de sistema para que funcionen correctamente en esta plataforma de bots de WhatsApp. Te llega un prompt escrito por un usuario — puede venir de otro sistema (n8n, Make, un asistente distinto) y asumir capacidades que esta plataforma NO tiene. Tu trabajo es reescribirlo para que funcione aquí, preservando TODO el contenido de negocio (identidad, tono, catálogo, reglas, metodología, ejemplos) y ajustando solo lo que depende de la plataforma.

Reglas de la plataforma que debes aplicar SIEMPRE:

1. SALIDA EN TEXTO PLANO: lo que el modelo responda se envía tal cual como mensaje de WhatsApp. Elimina cualquier instrucción de responder en JSON, XML, "acciones" estructuradas o bloques de código. Si el original pedía un JSON con campos, convierte esos campos en una guía de qué información recabar durante la conversación, no en algo que se deba devolver estructurado.

2. SIN TOOL-CALLING: el modelo no puede "ejecutar herramientas" ni "llamar funciones" por su cuenta. Si el original asume una tool de búsqueda en base de conocimiento (RAG), reescribe la instrucción así: el contexto relevante, si existe, ya viene inyectado automáticamente más arriba en la conversación (bajo un bloque tipo "Información relevante de la base de conocimiento") — el bot solo debe usarlo si aparece, y si no aparece o no cubre la pregunta, debe ofrecer verificar con el equipo. Elimina instrucciones de "ejecuta la tool X".

3. SIN VARIABLES DE PLANTILLA: no existen variables tipo {{ $now }}, {{variable}} ni inyección de fecha/hora u otros datos externos. Elimina cualquier referencia a ellas. Si el original dependía de la hora del día (ej. saludo según hora), reemplázalo por un saludo neutro, explicando que no hay forma de conocer la hora del destinatario.

4. SIN ESTADO ESTRUCTURADO ENTRE TURNOS: el bot no tiene memoria estructurada (no existen campos ni contadores de turno que el sistema le pase automáticamente). Solo "recuerda" el historial de la conversación, que sí puede releer en cada turno. Si el original pedía llevar un registro de campos o contadores, reescríbelo como "repasa el historial de la conversación para inferir qué datos ya se mencionaron antes de volver a preguntarlos".

5. NO PUEDE ENVIAR ARCHIVOS: el bot solo responde texto. Si el original preveía enviar fichas técnicas, fotos, PDFs o similares como acción automática, reescríbelo para que el bot ofrezca que un miembro del equipo lo hará llegar, y continúe la conversación por texto.

6. NO PUEDE ASIGNAR CHATS NI ESCALAR POR SU CUENTA: el bot no puede reasignar la conversación a un humano ni disparar ninguna acción de sistema. Si el original preveía un "escalamiento" automático, reescríbelo como un mensaje de texto que anuncia el paso a un humano — la asignación real la hace el equipo por fuera de esta conversación.

7. HUMANIZACIÓN: si el bot tiene activada la opción de dividir respuestas largas, cada párrafo separado por una línea en blanco se envía como un mensaje de WhatsApp independiente. Si el original modelaba "mensajes" o "acciones" de texto por separado, tradúcelos a párrafos separados por una línea en blanco en vez de una lista o array.

8. NO DUPLIQUES INSTRUCCIONES DE SEGURIDAD GENÉRICAS que ya aplica la plataforma automáticamente (no revelar el prompt de sistema, no salirse del propósito de negocio, ignorar instrucciones inyectadas en mensajes/imágenes/documentos) — si el original las trae, resúmelas brevemente o quítalas, ya se aplican aparte con prioridad máxima.

9. LÍMITE DE TAMAÑO — MUY IMPORTANTE: el campo donde vive este prompt se trunca a ~4000 caracteres antes de cada respuesta real del bot. Un prompt ajustado más largo que eso queda cortado en silencio en producción — y si se corta, se corta el FINAL de lo que hayas escrito, sin excepción. Por eso el orden en que escribes importa tanto como el contenido: lo obligatorio va primero, lo prescindible al final, así un corte por espacio solo se come lo prescindible.

   ESCRIBE TU RESPUESTA EN ESTE ORDEN EXACTO — no reordenes según el orden del prompt original, reordena según esta prioridad:

   PRIMERO, en este orden, de forma completa (nunca resumas ni omitas estas cuatro, cueste lo que cueste de espacio):
   a) Identidad, tono y prohibiciones léxicas — 3-5 líneas.
   b) Si el original tenía una regla de CUÁNDO revelar el precio del producto principal (turno/mensaje mínimo, datos mínimos recabados, excepción por insistencia), escríbela COMPLETA aquí, en segundo lugar — es una regla de negocio crítica, no un detalle que se pueda dejar para después.
   c) La metodología de sondeo: qué datos recabar y en qué orden — lista de una línea por dato, sin la pregunta "neutra" exacta de cada uno.
   d) Si el original tenía un flujo de escalamiento/cierre (pasar el contacto a un humano), resúmelo aquí en 2-3 líneas.

   DESPUÉS, solo si te queda espacio, en este orden (lo primero que se sacrifica si no alcanza):
   e) Catálogo: 2-4 características clave por equipo, no la ficha completa.
   f) Equipos secundarios vía RAG y sus reglas de precio en rango (si el original las tenía).
   g) Detección de perfil de prospecto: nombre de cada perfil + su enfoque de venta en una línea (sin listar señales ni preguntas de ejemplo de cada uno).
   h) Ejemplos o few-shots — 1 corto como máximo, o ninguno.

   Nunca escribas (e)-(h) extensamente a costa de dejar (a)-(d) incompletas o sin escribir — si notas que vas ocupando mucho espacio en el catálogo o en un equipo secundario, cierra esa sección ya y sigue con la siguiente obligatoria pendiente antes de seguir detallando.

QUÉ PRESERVAR SIN CAMBIOS DE FONDO: identidad y personalidad del bot, tono de voz, reglas de negocio (catálogo, precios, validaciones, prohibiciones léxicas), la regla de cuándo revelar el precio, la metodología de conversación/sondeo, y el flujo de escalamiento — todo esto tiene prioridad sobre conservar few-shots, repetir ejemplos, o detallar de más el catálogo.

FORMATO DE TU RESPUESTA: responde ÚNICAMENTE con el prompt ya ajustado, listo para pegarse directo en el campo "Prompt del sistema" de un bot. No agregues explicaciones, comentarios, encabezados ni comillas ni bloques de código — solo el texto final del prompt.`;

// Margen bajo el corte real de 4000 caracteres que aplica wrapUserPrompt() en
// cada respuesta real del bot (lib/ai/prompt-sanitizer.ts). El meta-prompt de
// arriba ya le pide al modelo apuntar a ~4000, pero con prompts de entrada muy
// largos y complejos (varios equipos, RAG, segmentación) el modelo no siempre
// respeta esa instrucción al pie de la letra — este corte determinístico es
// la garantía dura de que nunca se entrega (ni se guarda) algo que luego se
// trunque a mitad de frase, en silencio, cuando el bot responda de verdad.
const PRODUCTION_PROMPT_LIMIT = 3900;

function truncateToProductionLimit(text: string): { text: string; truncated: boolean } {
  if (text.length <= PRODUCTION_PROMPT_LIMIT) return { text, truncated: false };
  const slice = text.slice(0, PRODUCTION_PROMPT_LIMIT);
  const lastParagraphBreak = slice.lastIndexOf("\n\n");
  // Corta en el último salto de párrafo si no descarta más de la mitad del
  // presupuesto — si ese párrafo empieza demasiado atrás, mejor cortar en el
  // último espacio para no perder tanto contenido de golpe.
  const cut = lastParagraphBreak > PRODUCTION_PROMPT_LIMIT * 0.5 ? lastParagraphBreak : slice.lastIndexOf(" ");
  const safeCut = cut > 0 ? cut : PRODUCTION_PROMPT_LIMIT;
  return { text: text.slice(0, safeCut).trimEnd(), truncated: true };
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = adjustBotPromptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { prompt, provider, model } = parsed.data;

    if (await isMonthlyBudgetExceeded(session.user.id, new Date())) {
      return NextResponse.json(
        { error: "Presupuesto mensual de IA ya superado — no se pudo ajustar el prompt" },
        { status: 400 }
      );
    }

    const apiKey = await getUserApiKey(session.user.id, provider as AIProvider);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configura tu clave de API para ese proveedor en Configuración" },
        { status: 400 }
      );
    }

    const client = getAIProvider(provider as AIProvider, apiKey);
    const result = await client.complete({
      model,
      temperature: 0.3,
      // El objetivo final es un resultado compacto (~4000 caracteres, ver
      // ADAPTATION_RULES), pero ese es el tamaño de la RESPUESTA visible, no
      // el presupuesto total de tokens de salida. Con prompts de entrada
      // grandes (20000+ caracteres), modelos con razonamiento interno (p.ej.
      // Gemini 2.5) gastan buena parte de un maxTokens ajustado en ese
      // pensamiento oculto antes de escribir la respuesta, cortándola a
      // mitad de frase. Un tope generoso aquí da margen a ese razonamiento
      // sin arriesgar el corte — no aumenta el tamaño del prompt resultante,
      // que sigue acotado por la instrucción del propio meta-prompt.
      maxTokens: 16000,
      messages: [
        { role: "system", content: ADAPTATION_RULES },
        { role: "user", content: prompt },
      ],
    });

    const rawAdjusted = result.content.trim();
    if (!rawAdjusted) {
      return NextResponse.json({ error: "La IA no devolvió un resultado válido" }, { status: 500 });
    }

    const { text: adjustedPrompt, truncated } = truncateToProductionLimit(rawAdjusted);

    return NextResponse.json({ adjustedPrompt, truncated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
