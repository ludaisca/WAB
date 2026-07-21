import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unassignedLeadReplySchema } from "@/lib/validations";
import { findUnassignedLeadChats, sendManualBotReply } from "@/lib/whatsapp/unassigned-lead-reply";
import { isMonthlyBudgetExceeded, checkBudgetAlert } from "@/lib/ai/budget";
import { rateLimit } from "@/lib/rate-limit";

interface ReplyResult {
  chatId: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
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

    const rl = await rateLimit(`unassigned-leads-reply:${session.user.id}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
    }

    const body = await req.json();
    const parsed = unassignedLeadReplySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { botId, chatIds } = parsed.data;

    const bot = await prisma.wABot.findFirst({
      where: { id: botId, userId: session.user.id, isActive: true, status: "ACTIVE" },
    });
    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado o no está activo" }, { status: 400 });
    }

    const now = new Date();
    if (await isMonthlyBudgetExceeded(session.user.id, now)) {
      return NextResponse.json(
        { error: "Presupuesto mensual de IA ya superado — no se envió nada" },
        { status: 400 }
      );
    }

    // Dedupe — un chatId repetido en el body (bug de cliente o request armada
    // a mano) no debe traducirse en dos respuestas de IA reales al mismo lead.
    const uniqueChatIds = [...new Set(chatIds)];

    // Re-deriva del lado servidor el set válido actual (misma cuenta sin bot
    // activo + último mensaje inbound + ventana de 24h) — un chatId del
    // cliente que ya no califica (alguien más ya respondió, la ventana se
    // cerró desde que se cargó la lista) se reporta como "skipped", no se
    // descarta en silencio ni se intenta igual. También garantiza el scoping
    // multi-tenant: findUnassignedLeadChats ya filtra por getUserAccountIds.
    const validChats = await findUnassignedLeadChats(session.user.id, now);
    const validById = new Map(validChats.map((c) => [c.id, c]));

    const results: ReplyResult[] = [];
    let sentAny = false;

    // Secuencial, no Promise.all — evita saturar el proveedor de IA y la
    // Graph API de Meta (mismo criterio que sheet-export-runner.ts/campaign-worker.ts).
    for (const chatId of uniqueChatIds) {
      // Re-chequeo por iteración: el check de arriba corre una sola vez, y un
      // lote de hasta 50 envíos puede rebasar el presupuesto varias veces
      // sobre antes de que el siguiente request lo note.
      if (await isMonthlyBudgetExceeded(session.user.id, new Date())) {
        results.push({ chatId, status: "skipped", error: "Presupuesto mensual de IA superado a mitad del lote" });
        continue;
      }

      const candidate = validById.get(chatId);
      if (!candidate) {
        results.push({ chatId, status: "skipped", error: "Ya no calificaba (respondido o fuera de alcance)" });
        continue;
      }
      if (!candidate.withinServiceWindow) {
        results.push({ chatId, status: "skipped", error: "Ventana de 24h de Meta cerrada" });
        continue;
      }

      const chat = await prisma.wAChat.findUnique({
        where: { id: chatId },
        select: { id: true, remoteJid: true, account: true },
      });
      if (!chat) {
        results.push({ chatId, status: "skipped", error: "Chat no encontrado" });
        continue;
      }

      try {
        await sendManualBotReply(chat, bot, now);
        results.push({ chatId, status: "sent" });
        sentAny = true;
      } catch (err) {
        results.push({ chatId, status: "failed", error: err instanceof Error ? err.message : "Error desconocido" });
      }
    }

    if (sentAny) {
      await checkBudgetAlert(session.user.id, now);
    }

    return NextResponse.json({
      results,
      sentCount: results.filter((r) => r.status === "sent").length,
      failedCount: results.filter((r) => r.status === "failed").length,
      skippedCount: results.filter((r) => r.status === "skipped").length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
