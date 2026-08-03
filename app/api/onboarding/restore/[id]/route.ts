import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Sin sesión a propósito: se llama mientras el onboarding restaura un
// respaldo, antes de que exista ningún usuario para autenticar. El id es un
// cuid no adivinable devuelto solo al cliente que disparó esta restauración
// en particular — mismo modelo de "el token es el control de acceso" que el
// link público de chat (lib/whatsapp/chat-public-link.ts). Expone únicamente
// el estado, nunca datos de negocio.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const log = await prisma.systemRestoreLog.findUnique({
    where: { id },
    select: { id: true, status: true, errorMessage: true, completedAt: true },
  });
  if (!log) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(log);
}
