import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { createGoogleOAuthClient } from "@/lib/google/oauth-client";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const account = await prisma.googleAccount.findUnique({ where: { userId: session.user.id } });
  if (!account) {
    return NextResponse.json({ success: true });
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    await oauth2Client.revokeToken(decrypt(account.accessToken));
  } catch (err) {
    // No bloquea la desconexión local si Google ya invalidó el token por su
    // cuenta (ej. el usuario ya lo había revocado desde su cuenta de Google).
    console.error("[google-sheets] Error revocando token en Google:", err);
  }

  await prisma.googleAccount.delete({ where: { userId: session.user.id } });

  return NextResponse.json({ success: true });
}
