import { prisma } from "@/lib/prisma";

// Muestra representativa de las 34 tablas del schema (no exhaustiva) — sirve
// como metadata de sanidad en el manifest y como comparación post-restore,
// no como un conteo forense completo. Se excluyen tablas puente/join.
export async function getTableCounts(): Promise<Record<string, number>> {
  const [
    users,
    waAccounts,
    waChats,
    waMessages,
    contacts,
    tags,
    waCampaigns,
    waCampaignRecipients,
    waTemplates,
    waBots,
    waBotKnowledge,
    waLeadScorerBots,
    waLeadScores,
    leadSheetSources,
    leadSheetImportedRows,
    notifications,
    agentConversations,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.wAAccount.count(),
    prisma.wAChat.count(),
    prisma.wAMessage.count(),
    prisma.contact.count(),
    prisma.tag.count(),
    prisma.wACampaign.count(),
    prisma.wACampaignRecipient.count(),
    prisma.wATemplate.count(),
    prisma.wABot.count(),
    prisma.wABotKnowledge.count(),
    prisma.wALeadScorerBot.count(),
    prisma.wALeadScore.count(),
    prisma.leadSheetSource.count(),
    prisma.leadSheetImportedRow.count(),
    prisma.notification.count(),
    prisma.agentConversation.count(),
  ]);

  return {
    users,
    waAccounts,
    waChats,
    waMessages,
    contacts,
    tags,
    waCampaigns,
    waCampaignRecipients,
    waTemplates,
    waBots,
    waBotKnowledge,
    waLeadScorerBots,
    waLeadScores,
    leadSheetSources,
    leadSheetImportedRows,
    notifications,
    agentConversations,
  };
}
