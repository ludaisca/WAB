import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

// Único proveedor desde 2026-08: Google/Gemini. La key se lee de
// AppSettings.googleApiKey (cifrada con AES-256-GCM).
export async function getUserApiKey(userId: string): Promise<string | null> {
  const settings = await prisma.appSettings.findUnique({
    where: { userId },
  });

  if (!settings?.googleApiKey) return null;

  try {
    return decrypt(settings.googleApiKey);
  } catch {
    return null;
  }
}
