import { withMaintenanceGuard } from "@/lib/maintenance-guard";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function handleGET() {
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
    // Sin las credenciales OAuth del entorno la conexión guardada es inservible:
    // la UI debe decirlo en vez de mostrar "Conectado como…" con un banner de
    // error contradictorio.
    envConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI
    ),
  });
}

export const GET = withMaintenanceGuard(handleGET);
