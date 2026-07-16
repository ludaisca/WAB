import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
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
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    const nextActive = !bot.isActive;

    const updated = await prisma.wABot.update({
      where: { id },
      // Re-activating clears a stuck ERROR status (e.g. from a past API key or
      // provider failure) so the bot actually resumes receiving messages —
      // isActive alone isn't enough, the message pipeline also requires
      // status: "ACTIVE".
      data: nextActive ? { isActive: true, status: "ACTIVE" } : { isActive: false },
      select: {
        id: true,
        name: true,
        isActive: true,
        status: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
