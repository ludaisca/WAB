import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScorerBotUpdateSchema } from "@/lib/validations";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const scorer = await prisma.wALeadScorerBot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!scorer) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
    }

    return NextResponse.json(scorer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.wALeadScorerBot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = leadScorerBotUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    const fields = parsed.data;

    if (fields.name) data.name = fields.name;
    if (fields.provider) data.provider = fields.provider;
    if (fields.model) data.model = fields.model;
    if (fields.systemPrompt) data.systemPrompt = fields.systemPrompt;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.scheduleEnabled !== undefined) data.scheduleEnabled = fields.scheduleEnabled;
    if (fields.scheduleIntervalMinutes !== undefined) data.scheduleIntervalMinutes = fields.scheduleIntervalMinutes;

    // Turning scheduling off (or leaving it off) always clears the interval —
    // avoids a stale minutes value lingering once re-enabled with no explicit choice.
    const willBeEnabled = fields.scheduleEnabled ?? existing.scheduleEnabled;
    if (!willBeEnabled) data.scheduleIntervalMinutes = null;

    const updated = await prisma.wALeadScorerBot.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya tienes un calificador con ese nombre" }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.wALeadScorerBot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
    }

    await prisma.wALeadScorerBot.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
