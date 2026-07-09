import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startBaileysConnection } from "@/lib/whatsapp-baileys/connection-manager";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    const account = await prisma.wAAccount.create({
      data: {
        userId: session.user.id,
        name,
        channel: "BAILEYS",
        status: "PENDING",
      },
      select: { id: true, name: true, channel: true, status: true },
    });

    await startBaileysConnection(account.id);

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese nombre" }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
