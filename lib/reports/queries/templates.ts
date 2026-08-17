import { prisma } from "@/lib/prisma";

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  accountName: string;
  syncedAt: Date;
}

// Snapshot local — deliberadamente SIN llamar a Meta (lib/whatsapp/template-analytics.ts)
// para no meter una llamada de red paginada por plantilla dentro de un job que
// hoy es 100% local/determinístico. Ver plan del módulo Reportes.
export async function fetchTemplateRows(accountIds: string[]): Promise<TemplateRow[]> {
  const templates = await prisma.wATemplate.findMany({
    where: { waAccountId: { in: accountIds } },
    include: { waAccount: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    language: t.language,
    status: t.status,
    accountName: t.waAccount.name,
    syncedAt: t.syncedAt,
  }));
}
