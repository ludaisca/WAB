// Sincronización de plantillas con Meta — extraído de app/api/whatsapp/templates/route.ts
// (el POST manual de "Sincronizar") para que también lo use el tick desatendido
// de lib/workers/template-sync-worker.ts. Comportamiento idéntico al original:
// upsert de lo que Meta reporta, borra localmente lo que ya no está allá.

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const GRAPH_API = "https://graph.facebook.com/v21.0";

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
  const url = `${GRAPH_API}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const body = (await res.json().catch(() => ({}))) as { data?: MetaTemplateRow[] } & MetaError;

  if (!res.ok) {
    const msg = body.error?.error_user_msg ?? body.error?.message ?? "Error al sincronizar plantillas";
    throw new Error(msg);
  }

  return body.data ?? [];
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
