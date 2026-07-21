import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncExportsForUser } from "@/lib/google/sheet-export-runner";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const account = await prisma.googleAccount.findUnique({ where: { userId: session.user.id } });
  if (!account?.enabled) {
    return NextResponse.json({ error: "No tienes una cuenta de Google conectada" }, { status: 400 });
  }

  try {
    await syncExportsForUser(session.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al sincronizar con Google Sheets";
    await prisma.googleAccount.update({
      where: { userId: session.user.id },
      data: { lastSyncError: message.slice(0, 500) },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.googleAccount.findUnique({ where: { userId: session.user.id } });
  return NextResponse.json({ lastSyncedAt: updated?.lastSyncedAt });
}
