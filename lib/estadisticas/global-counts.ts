import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Contadores globales compartidos por /dashboard, /whatsapp (hub) y
// /estadisticas (get-stats.ts). Antes cada pantalla reimplementaba estas
// queries con cláusulas `where` ligeramente distintas para el mismo concepto —
// si cambiaba el modelo de cuentas compartidas, podían divergir en silencio.
// Todo lo scoping por cuenta se expresa vía `accountIds` (el resultado de
// getUserAccountIds, propias + compartidas); lo scoping por dueño vía `userId`.

export function countConnectedAccounts(accountIds: string[]) {
  return prisma.wAAccount.count({ where: { id: { in: accountIds }, status: "CONNECTED" } });
}

export function countChats(accountIds: string[], visibility?: Prisma.WAChatWhereInput | null) {
  return prisma.wAChat.count({ where: { accountId: { in: accountIds }, ...(visibility ? { AND: [visibility] } : {}) } });
}

export function countMessages(accountIds: string[], visibility?: Prisma.WAChatWhereInput | null) {
  return prisma.wAMessage.count({ where: { chat: { accountId: { in: accountIds }, ...(visibility ? { AND: [visibility] } : {}) } } });
}

export function countBots(userId: string) {
  return prisma.wABot.count({ where: { userId } });
}

export function countActiveBots(userId: string) {
  return prisma.wABot.count({ where: { userId, isActive: true, status: "ACTIVE" } });
}

export function countCampaigns(accountIds: string[]) {
  return prisma.wACampaign.count({ where: { waAccountId: { in: accountIds } } });
}

export function countCompletedCampaigns(accountIds: string[]) {
  return prisma.wACampaign.count({ where: { waAccountId: { in: accountIds }, status: "COMPLETED" } });
}
