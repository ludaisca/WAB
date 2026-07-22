import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Mismo bucket que confirm — rechazar repetidamente no debe ser una forma de
  // eludir el rate limit de acciones.
  const rl = await rateLimit(`agent-action-confirm:${session.user.id}`, 10, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas acciones en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const { id } = await params;

  const action = await prisma.agentAction.findFirst({ where: { id, userId: session.user.id } });
  if (!action) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const claimed = await prisma.agentAction.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedById: session.user.id },
  });
  if (claimed.count === 0) {
    const fresh = await prisma.agentAction.findUnique({ where: { id } });
    return NextResponse.json({ error: `La acción ya no está pendiente (estado actual: ${fresh?.status})` }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
