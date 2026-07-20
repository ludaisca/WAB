import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

    const existing = await prisma.notification.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Notificación no encontrada" }, { status: 404 });
    }

    const body = await req.json();
    const read = body?.read !== false;

    const updated = await prisma.notification.update({
      where: { id },
      data: { read },
      select: { id: true, read: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
