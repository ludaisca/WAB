import { google, sheets_v4 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { createGoogleOAuthClient } from "@/lib/google/oauth-client";

// Punto único de resolución de credencial, análogo a getUserApiKey()/decrypt(account.accessToken)
// para Meta — con una diferencia clave: aquí el access token puede rotar dentro
// del mismo proceso (el SDK lo refresca solo antes de cada llamada si detecta
// que expiró), así que la persistencia del token nuevo se hace vía el evento
// "tokens" del OAuth2Client, no con un chequeo manual de expiresAt.
export async function getGoogleSheetsClientForUser(userId: string): Promise<sheets_v4.Sheets | null> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account || !account.enabled) return null;

  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials({
    access_token: decrypt(account.accessToken),
    refresh_token: decrypt(account.refreshToken),
    expiry_date: account.accessTokenExpiresAt.getTime(),
  });

  oauth2Client.on("tokens", (tokens) => {
    const data: { accessToken?: string; refreshToken?: string; accessTokenExpiresAt?: Date } = {};
    if (tokens.access_token) data.accessToken = encrypt(tokens.access_token);
    // El refresh_token casi nunca se reemite tras el primero — solo se sobrescribe si Google manda uno nuevo.
    if (tokens.refresh_token) data.refreshToken = encrypt(tokens.refresh_token);
    if (tokens.expiry_date) data.accessTokenExpiresAt = new Date(tokens.expiry_date);
    if (Object.keys(data).length === 0) return;

    void prisma.googleAccount
      .update({ where: { userId }, data })
      .catch((err) => console.error("[google-sheets] Error persistiendo tokens refrescados:", err));
  });

  return google.sheets({ version: "v4", auth: oauth2Client });
}
