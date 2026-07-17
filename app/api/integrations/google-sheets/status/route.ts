import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const account = await prisma.googleAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    googleEmail: account.googleEmail,
    spreadsheetId: account.spreadsheetId,
    lastSyncedAt: account.lastSyncedAt,
    lastSyncError: account.lastSyncError,
    enabled: account.enabled,
  });
}
