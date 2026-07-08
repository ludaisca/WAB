import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { botSchema } from "@/lib/validations";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = botSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      name,
      waAccountId,
      provider,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      memoryType,
      memoryLimit,
      ragEnabled,
    } = parsed.data;

    const account = await prisma.wAAccount.findFirst({
      where: { id: waAccountId, userId: session.user.id },
    });

    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    await prisma.appSettings.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id },
      update: {},
    });

    const bot = await prisma.wABot.create({
      data: {
        userId: session.user.id,
        waAccountId,
        name,
        provider,
        model,
        systemPrompt,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens ?? 1024,
        memoryType: memoryType ?? "RECENT",
        memoryLimit: memoryLimit ?? 20,
        ragEnabled: ragEnabled ?? false,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        memoryType: true,
        memoryLimit: true,
        ragEnabled: true,
        isActive: true,
        status: true,
        waAccountId: true,
        createdAt: true,
      },
    });

    return NextResponse.json(bot, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const waAccountId = searchParams.get("waAccountId");

    const where: Record<string, unknown> = { userId: session.user.id };
    if (waAccountId) where.waAccountId = waAccountId;

    const bots = await prisma.wABot.findMany({
      where,
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        memoryType: true,
        memoryLimit: true,
        ragEnabled: true,
        isActive: true,
        status: true,
        waAccountId: true,
        createdAt: true,
        updatedAt: true,
        waAccount: {
          select: { id: true, name: true, phoneNumber: true },
        },
        _count: { select: { conversations: true, knowledgeBots: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(bots);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
