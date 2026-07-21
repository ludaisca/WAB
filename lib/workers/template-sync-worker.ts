// Tick desatendido que refresca WATemplate.status (y el resto de los campos)
// sin depender de que alguien pulse "Sincronizar" manualmente — antes solo se
// actualizaba con esa acción manual. Recorre TODAS las WAAccount con
// wabaId+accessToken configurados, sin importar el usuario dueño: es trabajo
// de fondo, no una acción de un usuario en particular.

import { prisma } from "@/lib/prisma";
import { syncAccountTemplates } from "@/lib/whatsapp/template-sync";

export async function processTemplateSyncTick() {
  const accounts = await prisma.wAAccount.findMany({
    where: {
      wabaId: { not: null },
      accessToken: { not: null },
    },
    select: { id: true, wabaId: true, accessToken: true },
  });

  for (const account of accounts) {
    try {
      await syncAccountTemplates({
        id: account.id,
        wabaId: account.wabaId as string,
        accessToken: account.accessToken as string,
      });
    } catch (err) {
      console.error(`[template-sync] Error sincronizando plantillas de la cuenta ${account.id}:`, err instanceof Error ? err.message : err);
    }

    // Pequeño respiro entre cuentas para no golpear la Graph API de golpe —
    // mismo criterio que campaign-worker.ts / lead-sheet-import.ts.
    await new Promise((r) => setTimeout(r, 200));
  }
}
