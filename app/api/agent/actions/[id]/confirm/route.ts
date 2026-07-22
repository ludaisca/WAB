import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getTool } from "@/lib/agent/tools/registry";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rl = await rateLimit(`agent-action-confirm:${session.user.id}`, 10, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas confirmaciones en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const { id } = await params;

  const action = await prisma.agentAction.findFirst({ where: { id, userId: session.user.id } });
  if (!action) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  // Claim atómico (mismo patrón que campaigns/send) — evita doble-ejecución por
  // doble clic y es el único punto que garantiza "un humano, una vez".
  const claimed = await prisma.agentAction.updateMany({
    where: { id, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    data: { status: "EXECUTED", resolvedAt: new Date(), resolvedById: session.user.id },
  });
  if (claimed.count === 0) {
    const fresh = await prisma.agentAction.findUnique({ where: { id } });
    return NextResponse.json({ error: `La acción ya no está pendiente (estado actual: ${fresh?.status})` }, { status: 409 });
  }

  const tool = getTool(action.toolName);
  if (!tool?.executeConfirm) {
    await prisma.agentAction.update({ where: { id }, data: { status: "FAILED", errorMessage: "Tool desconocida o sin executeConfirm" } });
    return NextResponse.json({ error: "Tool desconocida o sin executeConfirm" }, { status: 500 });
  }

  try {
    // executeConfirm() revalida sus propias precondiciones (¿el bot sigue existiendo?,
    // ¿la campaña sigue en DRAFT?, ¿la plantilla sigue APPROVED?) — el estado real pudo
    // cambiar desde que se propuso la acción.
    const result = await tool.executeConfirm(action.params, { userId: action.userId, conversationId: action.conversationId });
    await prisma.agentAction.update({ where: { id }, data: { result: result as never } });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentAction.update({ where: { id }, data: { status: "FAILED", errorMessage: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
