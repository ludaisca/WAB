import { NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { createGoogleOAuthClient } from "@/lib/google/oauth-client";

const CONFIG_URL = "/configuracion";

// req.url refleja el host que ve el contenedor internamente (ej. "0.0.0.0:5000"
// con Docker + un túnel como ngrok, o el puerto interno detrás de Traefik en
// producción), no el dominio público por el que el usuario realmente entró.
// Los proxies/túneles sí mandan x-forwarded-proto/x-forwarded-host correctos,
// así que se prefieren esos para construir cualquier redirect absoluto.
function absoluteUrl(path: string, req: Request): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return new URL(path, `${forwardedProto ?? "https"}://${forwardedHost}`);
  }
  return new URL(path, req.url);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_error=denied`, req));
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_error=invalid`, req));
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(absoluteUrl("/login", req));
  }

  let stateUserId: string;
  try {
    const parsed = JSON.parse(decrypt(state));
    stateUserId = parsed.userId;
  } catch {
    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_error=invalid`, req));
  }

  if (stateUserId !== session.user.id) {
    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_error=invalid`, req));
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const { data: userinfo } = await oauth2.userinfo.get();
    const googleEmail = userinfo.email;
    if (!googleEmail) throw new Error("Google no devolvió el email de la cuenta");

    const existing = await prisma.googleAccount.findUnique({ where: { userId: session.user.id } });

    let spreadsheetId = existing?.spreadsheetId ?? null;
    if (!spreadsheetId) {
      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      const created = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: "WAB - Sincronización" },
          sheets: [
            { properties: { title: "Leads calificados" } },
            { properties: { title: "Resultados de campaña" } },
          ],
        },
      });
      spreadsheetId = created.data.spreadsheetId ?? null;
    }

    if (!tokens.expiry_date) throw new Error("Google no devolvió la expiración del access token");

    // El refresh_token solo llega en el primer consentimiento — si por algún
    // motivo esta respuesta no lo trae, hay que conservar el que ya teníamos
    // en vez de sobreescribirlo con null (perdería la conexión sin avisar).
    const refreshToken = tokens.refresh_token ?? (existing ? decrypt(existing.refreshToken) : null);
    if (!refreshToken) throw new Error("Google no devolvió refresh_token en la primera conexión");

    await prisma.googleAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        googleEmail,
        accessToken: encrypt(tokens.access_token!),
        refreshToken: encrypt(refreshToken),
        accessTokenExpiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope ?? "",
        spreadsheetId,
        enabled: true,
        lastSyncError: null,
      },
      update: {
        googleEmail,
        accessToken: encrypt(tokens.access_token!),
        refreshToken: encrypt(refreshToken),
        accessTokenExpiresAt: new Date(tokens.expiry_date),
        scope: tokens.scope ?? "",
        spreadsheetId,
        enabled: true,
        lastSyncError: null,
      },
    });

    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_connected=1`, req));
  } catch (err) {
    console.error("[google-sheets] Error en callback OAuth:", err);
    return NextResponse.redirect(absoluteUrl(`${CONFIG_URL}?google_error=failed`, req));
  }
}
