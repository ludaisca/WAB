import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getConnectionInfo } from "@/lib/whatsapp-baileys/connection-manager";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const account = await prisma.wAAccount.findFirst({
      where: { id, userId: session.user.id, channel: "BAILEYS" },
      select: { id: true, status: true, phoneNumber: true, errorMessage: true },
    });

    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const live = getConnectionInfo(id);

    return NextResponse.json({
      status: account.status,
      phoneNumber: account.phoneNumber,
      errorMessage: account.errorMessage,
      qr: live?.status === "PENDING" ? live.qr : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
