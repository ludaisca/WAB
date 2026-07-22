import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { botUpdateSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { deleteBot } from "@/lib/whatsapp/bots";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const bot = await prisma.wABot.findFirst({
      where: { id, userId: session.user.id },
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
        humanizeEnabled: true,
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
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    return NextResponse.json(bot);
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
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.wABot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = botUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    const fields = parsed.data;

    if (fields.name) data.name = fields.name;
    if (fields.waAccountId !== undefined) {
      if (fields.waAccountId) {
        const accountIds = await getUserAccountIds(session.user.id);
        if (!accountIds.includes(fields.waAccountId)) {
          return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
        }
        // Reasignar un bot YA activo a otra cuenta que también tiene un bot
        // activo produciría el mismo doble-respuesta que /toggle ya evita —
        // este es el otro único punto donde waAccountId cambia.
        if (existing.isActive && existing.status === "ACTIVE" && fields.waAccountId !== existing.waAccountId) {
          const conflict = await prisma.wABot.findFirst({
            where: { waAccountId: fields.waAccountId, isActive: true, status: "ACTIVE", id: { not: id } },
            select: { name: true },
          });
          if (conflict) {
            return NextResponse.json(
              { error: `Ya hay un bot activo en esa cuenta ("${conflict.name}") — desactívalo primero` },
              { status: 400 }
            );
          }
        }
      }
      data.waAccountId = fields.waAccountId || null;
    }
    if (fields.provider) data.provider = fields.provider;
    if (fields.model) data.model = fields.model;
    if (fields.systemPrompt) data.systemPrompt = fields.systemPrompt;
    if (fields.temperature !== undefined) data.temperature = fields.temperature;
    if (fields.maxTokens !== undefined) data.maxTokens = fields.maxTokens;
    if (fields.memoryType) data.memoryType = fields.memoryType;
    if (fields.memoryLimit !== undefined) data.memoryLimit = fields.memoryLimit;
    if (fields.ragEnabled !== undefined) data.ragEnabled = fields.ragEnabled;
    if (fields.humanizeEnabled !== undefined) data.humanizeEnabled = fields.humanizeEnabled;

    const updated = await prisma.wABot.update({
      where: { id },
      data,
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
        humanizeEnabled: true,
        isActive: true,
        status: true,
        waAccountId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
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
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    await deleteBot(id, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
