import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";

interface AudioTranscribeJob {
  messageId: string;
}

// Se pide transcripción literal, sin añadir nada — el resultado va directo a
// la burbuja del chat como texto del usuario.
const TRANSCRIBE_PROMPT =
  "Transcribe el audio de esta nota de voz literalmente (palabra por palabra, en su idioma original), " +
  "sin añadir comentarios, aclaraciones ni respuestas. Si el audio está vacío o es inaudible, responde solo «[audio inaudible]».";

// Transcribe una nota de voz entrante con el modelo por defecto del usuario.
// Se encola desde media-worker.ts SOLO después de que el archivo ya quedó en
// disco (mediaUrl poblado), así que aquí nunca hay carrera con la descarga.
// Si algo falla (sin API key, presupuesto agotado, audio purgado por
// media-cleanup) se sale en silencio — la transcripción es un extra de UX,
// nunca una operación crítica que deba reintentar o notificar.
export async function processAudioTranscribeJob(job: AudioTranscribeJob) {
  const message = await prisma.wAMessage.findUnique({
    where: { id: job.messageId },
    select: {
      id: true,
      transcription: true,
      mediaUrl: true,
      mimeType: true,
      chat: { select: { account: { select: { userId: true } } } },
    },
  });

  if (!message) return;
  if (message.transcription) return; // ya transcrito (job duplicado)
  if (!message.mediaUrl) return; // media nunca descargado o purgado por retención

  const userId = message.chat.account.userId;

  if (await isMonthlyBudgetExceeded(userId, new Date())) {
    console.log(`[audio-transcribe] Presupuesto mensual de IA superado — se omite la transcripción del mensaje ${job.messageId}`);
    return;
  }

  const apiKey = await getUserApiKey(userId);
  if (!apiKey) return;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(resolveAbsolutePath(message.mediaUrl));
  } catch (err) {
    console.error(`[audio-transcribe] No se pudo leer el audio local del mensaje ${job.messageId}:`, err);
    return;
  }

  const mime = message.mimeType ?? "audio/ogg";
  const base64 = buffer.toString("base64");

  const settings = await prisma.appSettings.findUnique({
    where: { userId },
    select: { defaultModel: true },
  });
  const model = settings?.defaultModel ?? "gemini-2.5-flash";

  const client = getAIProvider(apiKey);
  const result = await client.complete({
    model,
    temperature: 0,
    maxTokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "audio_url", audio_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
  });

  const transcription = result.content.trim();
  if (!transcription) return;

  await prisma.wAMessage.update({
    where: { id: job.messageId },
    data: { transcription },
  });

  if (result.usage) {
    const promptTokens = result.usage.promptTokens;
    const completionTokens = result.usage.completionTokens;
    const cost = await estimateCost(model, promptTokens, completionTokens);
    await prisma.audioTranscriptionUsage.create({
      data: {
        userId,
        messageId: job.messageId,
        model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: cost,
      },
    });
  }
}
