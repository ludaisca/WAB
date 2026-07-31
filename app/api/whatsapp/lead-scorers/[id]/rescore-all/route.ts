import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScoringQueue } from "@/lib/queue";
import { countBulkRescoreEligibleChats } from "@/lib/workers/lead-scoring-worker";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "user") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const scorer = await prisma.wALeadScorerBot.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!scorer) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
    }

    const estimatedCount = await countBulkRescoreEligibleChats(scorer);
    await leadScoringQueue.add("rescore-all", { scorerId: scorer.id });

    return NextResponse.json({ queued: true, estimatedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
