import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { createGoogleOAuthClient, GOOGLE_SHEETS_SCOPES } from "@/lib/google/oauth-client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const oauth2Client = createGoogleOAuthClient();
  // "state" protege contra CSRF (parte del spec OAuth2) y además nos deja
  // confirmar en el callback que el code pertenece al mismo usuario que
  // inició el flujo, cifrado con la misma clave que el resto de secretos.
  const state = encrypt(JSON.stringify({ userId: session.user.id, nonce: randomUUID() }));

  const authUrl = oauth2Client.generateAuthUrl({
    // access_type "offline" es obligatorio para recibir refresh_token.
    access_type: "offline",
    // prompt "consent" es obligatorio SIEMPRE (no solo la primera vez): si el
    // usuario se desconecta y reconecta, sin esto Google no vuelve a mandar
    // refresh_token porque reusa el consentimiento ya otorgado.
    prompt: "consent",
    scope: GOOGLE_SHEETS_SCOPES,
    state,
  });

  return NextResponse.redirect(authUrl);
}
