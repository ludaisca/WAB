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

QUÉ PRESERVAR SIN CAMBIOS DE FONDO: identidad y personalidad del bot, tono de voz, reglas de negocio (catálogo, precios, validaciones, prohibiciones léxicas), metodología de conversación/sondeo (como guía, no como extracción de datos), y cualquier ejemplo o few-shot (conviértelos a texto plano si estaban en JSON, preservando el contenido y estilo que ilustran).

FORMATO DE TU RESPUESTA: responde ÚNICAMENTE con el prompt ya ajustado, listo para pegarse directo en el campo "Prompt del sistema" de un bot. No agregues explicaciones, comentarios, encabezados ni comillas ni bloques de código — solo el texto final del prompt.`;

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
      maxTokens: 4000,
      messages: [
        { role: "system", content: ADAPTATION_RULES },
        { role: "user", content: prompt },
      ],
    });

    const adjustedPrompt = result.content.trim();
    if (!adjustedPrompt) {
      return NextResponse.json({ error: "La IA no devolvió un resultado válido" }, { status: 500 });
    }

    return NextResponse.json({ adjustedPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
