import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import type { AIProvider } from "./types";

export async function getUserApiKey(userId: string, provider: AIProvider): Promise<string | null> {
  const settings = await prisma.appSettings.findUnique({
    where: { userId },
  });

  if (!settings) return null;

  const encrypted = provider === "openrouter"
    ? settings.openrouterApiKey
    : settings.googleApiKey;

  if (!encrypted) return null;

  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export async function getUserAiSettings(userId: string) {
  return prisma.appSettings.findUnique({ where: { userId } });
}
