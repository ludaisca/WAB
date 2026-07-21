import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadScorerBotSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "user") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = leadScorerBotSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, provider, model, systemPrompt, isActive, scheduleEnabled, scheduleIntervalMinutes, scheduleAccountIds } = parsed.data;

    let validAccountIds: string[] = [];
    if (scheduleAccountIds && scheduleAccountIds.length > 0) {
      const ownedIds = await getUserAccountIds(session.user.id);
      const ownedSet = new Set(ownedIds);
      if (scheduleAccountIds.some((id) => !ownedSet.has(id))) {
        return NextResponse.json({ error: "Cuenta inválida en el alcance del calificador" }, { status: 400 });
      }
      validAccountIds = scheduleAccountIds;
    }

    await prisma.appSettings.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id },
      update: {},
    });

    const scorer = await prisma.wALeadScorerBot.create({
      data: {
        userId: session.user.id,
        name,
        provider,
        model,
        systemPrompt,
        isActive: isActive ?? true,
        scheduleEnabled: scheduleEnabled ?? false,
        scheduleIntervalMinutes: scheduleEnabled ? scheduleIntervalMinutes : null,
        scheduleAccountIds: validAccountIds,
      },
    });

    return NextResponse.json(scorer, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya tienes un calificador con ese nombre" }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "user") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const scorers = await prisma.wALeadScorerBot.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(scorers);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
