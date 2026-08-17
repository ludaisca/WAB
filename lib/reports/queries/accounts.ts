import { prisma } from "@/lib/prisma";

export interface AccountRow {
  id: string;
  name: string;
  phoneNumber: string | null;
  origen: string | null;
  status: string;
  qualityRating: string | null;
  messagingTier: string | null;
  qualityUpdatedAt: Date | null;
}

// Snapshot al momento de generar el reporte — qualityRating/messagingTier
// solo se actualizan de forma reactiva vía el webhook phone_number_quality_update
// de Meta (ver AGENTS.md § Webhook), no hay endpoint para pedirlos on-demand.
export async function fetchAccountRows(accountIds: string[]): Promise<AccountRow[]> {
  return prisma.wAAccount.findMany({
    where: { id: { in: accountIds } },
    select: {
      id: true, name: true, phoneNumber: true, origen: true, status: true,
      qualityRating: true, messagingTier: true, qualityUpdatedAt: true,
    },
    orderBy: { name: "asc" },
  });
}
