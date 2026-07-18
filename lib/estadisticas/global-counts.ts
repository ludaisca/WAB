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

export function countChats(accountIds: string[]) {
  return prisma.wAChat.count({ where: { accountId: { in: accountIds } } });
}

export function countMessages(accountIds: string[]) {
  return prisma.wAMessage.count({ where: { chat: { accountId: { in: accountIds } } } });
}

export function countBots(userId: string) {
  return prisma.wABot.count({ where: { userId } });
}

export function countActiveBots(userId: string) {
  return prisma.wABot.count({ where: { userId, isActive: true } });
}

export function countCampaigns(userId: string) {
  return prisma.wACampaign.count({ where: { userId } });
}

export function countCompletedCampaigns(userId: string) {
  return prisma.wACampaign.count({ where: { userId, status: "COMPLETED" } });
}
