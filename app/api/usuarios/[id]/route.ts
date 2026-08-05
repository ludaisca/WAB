import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// No existía ruta de baja de usuario — solo GET (lista), PATCH (rol) y POST
// (alta) en app/api/usuarios/route.ts. `WAAccount.userId` tiene
// onDelete: Cascade (prisma/schema.prisma) — borrar un User cascade-borra
// TODAS sus cuentas de WhatsApp propias (y con ellas chats/mensajes/
// campañas/bots), así que esto es tan destructivo como "Eliminar cuenta" en
// /whatsapp/cuentas — mismas guardas que ya protegen PATCH (admin principal,
// último admin) más un guard extra: nunca borrarse a uno mismo.
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

    if (id === session.user.id) {
      return NextResponse.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // Mismo invariante que PATCH: el admin principal nunca se puede quitar, y
    // el sistema jamás puede quedarse sin administradores.
    if (target.role === "admin") {
      const [firstUser, adminCount] = await Promise.all([
        prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
        prisma.user.count({ where: { role: "admin" } }),
      ]);
      if (firstUser?.id === target.id) {
        return NextResponse.json(
          { error: "El administrador principal no se puede eliminar" },
          { status: 400 }
        );
      }
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "No puedes eliminar al último administrador del sistema" },
          { status: 400 }
        );
      }
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
