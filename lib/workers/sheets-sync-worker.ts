import { prisma } from "@/lib/prisma";
import { syncExportsForUser } from "@/lib/google/sheet-export-runner";
import { isRevokedGrantError } from "@/lib/google/errors";
import type { GoogleAccount } from "@prisma/client";

export async function processSheetsSyncTick() {
  const accounts = await prisma.googleAccount.findMany({ where: { enabled: true } });

  for (const account of accounts) {
    try {
      await syncExportsForUser(account.userId);
    } catch (err) {
      await handleSyncError(account, err);
    }
  }
}

async function handleSyncError(account: GoogleAccount, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[sheets-sync] Error sincronizando cuenta de Google del usuario ${account.userId}:`, err);

  if (isRevokedGrantError(err)) {
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        enabled: false,
        lastSyncError: "El acceso a Google fue revocado. Vuelve a conectar tu cuenta en Configuración.",
      },
    });
    await prisma.notification.create({
      data: {
        userId: account.userId,
        type: "BOT_ERROR",
        title: "Se desconectó la sincronización con Google Sheets",
        body: "Detectamos que el acceso fue revocado desde tu cuenta de Google. Vuelve a conectar en Configuración para reanudar la sincronización.",
        link: "/configuracion",
      },
    });
    return;
  }

  await prisma.googleAccount.update({
    where: { id: account.id },
    data: { lastSyncError: message.slice(0, 500) },
  });
}
