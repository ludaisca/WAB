// Sincronización de plantillas con Meta — extraído de app/api/whatsapp/templates/route.ts
// (el POST manual de "Sincronizar") para que también lo use el tick desatendido
// de lib/workers/template-sync-worker.ts. Comportamiento idéntico al original:
// upsert de lo que Meta reporta, borra localmente lo que ya no está allá.

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

import { GRAPH_API } from "@/lib/whatsapp/graph-api";

interface MetaError {
  error?: { message?: string; error_user_msg?: string };
}

interface MetaTemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

async function fetchMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplateRow[]> {
  const all: MetaTemplateRow[] = [];
  // Meta pagina message_templates (25 por página si no se pide `limit`
  // explícito). Sin seguir `paging.next`, cualquier cuenta con más de una
  // página perdía silenciosamente sus plantillas restantes en cada sync:
  // syncAccountTemplates() borra localmente todo lo que no vino en esta
  // respuesta (ver deleteMany de abajo), y este tick corre cada 15 min sobre
  // TODAS las cuentas — confirmado en producción: 6 cuentas quedaron clavadas
  // en exactamente 25 plantillas. `limit=100` reduce los round-trips, pero lo
  // que realmente arregla el bug es seguir `paging.next` hasta agotarlo.
  let url: string | null = `${GRAPH_API}/${wabaId}/message_templates?limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = (await res.json().catch(() => ({}))) as
      { data?: MetaTemplateRow[]; paging?: { next?: string } } & MetaError;

    if (!res.ok) {
      const msg = body.error?.error_user_msg ?? body.error?.message ?? "Error al sincronizar plantillas";
      throw new Error(msg);
    }

    all.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }

  return all;
}

export interface SyncableAccount {
  id: string;
  wabaId: string;
  accessToken: string; // encriptado, tal como viene de WAAccount
}

/**
 * Sincroniza las plantillas de Meta para una cuenta: upsert de las que existen
 * allá, borra localmente las que ya no. Usada tanto por el POST manual de
 * /api/whatsapp/templates como por processTemplateSyncTick().
 */
export async function syncAccountTemplates(account: SyncableAccount): Promise<number> {
  const accessToken = decrypt(account.accessToken);
  const metaTemplates = await fetchMetaTemplates(account.wabaId, accessToken);

  for (const t of metaTemplates) {
    await prisma.wATemplate.upsert({
      where: {
        waAccountId_templateId: {
          waAccountId: account.id,
          templateId: t.id,
        },
      },
      create: {
        waAccountId: account.id,
        templateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components as object,
        syncedAt: new Date(),
      },
      update: {
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components as object,
        syncedAt: new Date(),
      },
    });
  }

  const syncedIds = metaTemplates.map((t) => t.id);
  await prisma.wATemplate.deleteMany({
    where: {
      waAccountId: account.id,
      templateId: { notIn: syncedIds },
    },
  });

  return metaTemplates.length;
}
