import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const { userId } = (await req.json()) as { userId: string };

    if (!userId) {
      return NextResponse.json({ error: "userId requerido" }, { status: 400 });
    }

    // Solo el dueño comparte su propia cuenta — sin este filtro, cualquier
    // admin podía concederse visibilidad sobre cuentas de otro admin.
    const account = await prisma.wAAccount.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    if (userId === account.userId) {
      return NextResponse.json({ error: "El dueño ya tiene acceso a la cuenta" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const share = await prisma.wAAccountShare.upsert({
      where: { waAccountId_userId: { waAccountId: id, userId } },
      create: { waAccountId: id, userId },
      update: {},
    });

    return NextResponse.json({ success: true, shared: share });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId requerido" }, { status: 400 });
    }

    await prisma.wAAccountShare.deleteMany({
      where: { waAccountId: id, userId, waAccount: { userId: session.user.id } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const shares = await prisma.wAAccountShare.findMany({
      where: { waAccountId: id, waAccount: { userId: session.user.id } },
      select: {
        userId: true,
        // role incluido: la tarjeta "Compartir cuenta" lo muestra junto al nombre.
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return NextResponse.json(shares.map((s) => s.user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
