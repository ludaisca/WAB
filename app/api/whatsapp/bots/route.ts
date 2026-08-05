import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { botSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";

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
    const parsed = botSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      name,
      waAccountIds,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      memoryType,
      memoryLimit,
      ragEnabled,
      humanizeEnabled,
      priceLookupEnabled,
      priceLookupUrl,
      priceLookupParam,
      priceLookupExtraQuery,
      priceLookupSkus,
    } = parsed.data;

    if (waAccountIds?.length) {
      // getUserAccountIds() (propias + compartidas), no userId directo — un
      // admin con una cuenta compartida por otro admin debe poder asociarle
      // un bot, igual que ya puede con chats/plantillas/campañas.
      const accountIds = await getUserAccountIds(session.user.id);
      const invalid = waAccountIds.find((id) => !accountIds.includes(id));
      if (invalid) {
        return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
      }
    }

    await prisma.appSettings.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id },
      update: {},
    });

    const bot = await prisma.wABot.create({
      data: {
        userId: session.user.id,
        accounts: waAccountIds?.length
          ? { create: waAccountIds.map((waAccountId) => ({ waAccountId })) }
          : undefined,
        name,
        model,
        systemPrompt,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens ?? 1024,
        memoryType: memoryType ?? "RECENT",
        memoryLimit: memoryLimit ?? 20,
        ragEnabled: ragEnabled ?? false,
        humanizeEnabled: humanizeEnabled ?? false,
        priceLookupEnabled: priceLookupEnabled ?? false,
        priceLookupUrl: priceLookupUrl || null,
        priceLookupParam: priceLookupParam || "keywords",
        priceLookupExtraQuery: priceLookupExtraQuery || null,
        priceLookupSkus: priceLookupSkus ?? [],
      },
      select: {
        id: true,
        name: true,
        model: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        memoryType: true,
        memoryLimit: true,
        ragEnabled: true,
        humanizeEnabled: true,
        priceLookupEnabled: true,
        priceLookupUrl: true,
        priceLookupParam: true,
        priceLookupExtraQuery: true,
        priceLookupSkus: true,
        isActive: true,
        status: true,
        accounts: { select: { waAccountId: true } },
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
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const waAccountId = searchParams.get("waAccountId");

    const where: Record<string, unknown> = { userId: session.user.id };
    if (waAccountId) where.accounts = { some: { waAccountId } };

    const bots = await prisma.wABot.findMany({
      where,
      select: {
        id: true,
        name: true,
        model: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        memoryType: true,
        memoryLimit: true,
        ragEnabled: true,
        humanizeEnabled: true,
        isActive: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        accounts: {
          select: { waAccount: { select: { id: true, name: true, phoneNumber: true } } },
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
