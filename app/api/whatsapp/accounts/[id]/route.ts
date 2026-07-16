import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { waAccountUpdateSchema } from "@/lib/validations";
import { encrypt, hashToken } from "@/lib/crypto";
import { validateToken } from "@/lib/whatsapp";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const account = await prisma.wAAccount.findFirst({
      where: {
        id,
        OR: [
          { userId: session.user.id },
          { sharedWith: { some: { userId: session.user.id } } },
        ],
      },
      select: {
        id: true,
        userId: true,
        name: true,
        channel: true,
        phoneNumber: true,
        phoneNumberId: true,
        wabaId: true,
        appId: true,
        status: true,
        errorMessage: true,
        lastActivity: true,
        autoAssignEnabled: true,
        qualityRating: true,
        messagingTier: true,
        qualityUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chats: true, templates: true } },
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Cuenta no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(account);
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

    const existing = await prisma.wAAccount.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Cuenta no encontrada" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = waAccountUpdateSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0].message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    const { name, accessToken, verifyToken, appSecret, wabaId, appId } = parsed.data;

    if (name) data.name = name;
    if (wabaId !== undefined) data.wabaId = wabaId || null;
    if (appId !== undefined) data.appId = appId || null;

    if (typeof body?.autoAssignEnabled === "boolean") {
      data.autoAssignEnabled = body.autoAssignEnabled;
    }

    if (accessToken) {
      if (existing.channel !== "META_CLOUD" || !existing.phoneNumberId) {
        return NextResponse.json(
          { error: "El token de acceso solo aplica a cuentas de Meta Cloud API" },
          { status: 400 }
        );
      }
      await validateToken(existing.phoneNumberId, accessToken);
      data.accessToken = encrypt(accessToken);
    }

    if (verifyToken) {
      data.verifyTokenHash = hashToken(verifyToken);
    }

    if (appSecret !== undefined) {
      if (appSecret) {
        data.appSecret = encrypt(appSecret);
      } else {
        data.appSecret = null;
      }
    }

    const updated = await prisma.wAAccount.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        channel: true,
        phoneNumber: true,
        phoneNumberId: true,
        wabaId: true,
        appId: true,
        status: true,
        errorMessage: true,
        lastActivity: true,
        autoAssignEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    const status = message.includes("Token validation failed") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
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

    const existing = await prisma.wAAccount.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Cuenta no encontrada" },
        { status: 404 }
      );
    }


    await prisma.wAAccount.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
