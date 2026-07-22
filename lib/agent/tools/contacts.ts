import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

const MAX_LIST = 30;

export const contactsList: ToolDefinition<{ search?: string; leadStatus?: string; limit?: number }> = {
  name: "contacts.list",
  riskTier: "READ",
  description: "Lista contactos/leads del usuario, opcionalmente filtrados por nombre/teléfono o por leadStatus (NEW, CONTACTED, QUALIFIED, CUSTOMER, LOST) — este es el embudo CRM manual, DISTINTO de la calificación de leads por IA (frio/interesado/oportunidad/prioridad_alta/descartado), que se consulta con scorers.scores.list.",
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Busca por nombre o número de teléfono (remoteJid)" },
      leadStatus: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "CUSTOMER", "LOST"] },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_LIST})` },
    },
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const take = Math.min(params.limit ?? 20, MAX_LIST);
    const contacts = await prisma.contact.findMany({
      where: {
        accountId: { in: accountIds },
        ...(params.leadStatus ? { leadStatus: params.leadStatus as never } : {}),
        ...(params.search
          ? { OR: [{ name: { contains: params.search, mode: "insensitive" } }, { remoteJid: { contains: params.search } }] }
          : {}),
      },
      select: { id: true, name: true, realName: true, remoteJid: true, leadStatus: true, accountId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take,
    });
    return { contacts, count: contacts.length };
  },
};

export const contactsGet: ToolDefinition<{ contactId: string }> = {
  name: "contacts.get",
  riskTier: "READ",
  description: "Obtiene el detalle de un contacto por id, incluyendo tags y notas.",
  parameters: {
    type: "object",
    properties: { contactId: { type: "string" } },
    required: ["contactId"],
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const contact = await prisma.contact.findFirst({
      where: { id: params.contactId, accountId: { in: accountIds } },
      include: {
        tags: { include: { tag: { select: { name: true } } } },
        notes: { orderBy: { createdAt: "desc" }, take: 10, select: { body: true, createdAt: true } },
      },
    });
    if (!contact) return { error: "Contacto no encontrado" };
    return { ...contact, tags: contact.tags.map((t) => t.tag.name) };
  },
};

export const contactsLeadStatusSet: ToolDefinition<{ contactId: string; leadStatus: "NEW" | "CONTACTED" | "QUALIFIED" | "CUSTOMER" | "LOST" }> = {
  name: "contacts.leadStatus.set",
  riskTier: "MINOR",
  description: "Cambia el leadStatus de un contacto (NEW, CONTACTED, QUALIFIED, CUSTOMER, LOST) — el embudo CRM manual. NO uses esta herramienta para \"calificar\" un lead con frio/interesado/oportunidad/prioridad_alta/descartado: esa es la calificación de IA (WALeadScore), un concepto distinto que no se puede asignar manualmente, solo corriendo un Calificador real.",
  parameters: {
    type: "object",
    properties: {
      contactId: { type: "string" },
      leadStatus: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "CUSTOMER", "LOST"] },
    },
    required: ["contactId", "leadStatus"],
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const existing = await prisma.contact.findFirst({ where: { id: params.contactId, accountId: { in: accountIds } } });
    if (!existing) throw new NotFoundError("Contacto no encontrado");

    return prisma.contact.update({
      where: { id: params.contactId },
      data: { leadStatus: params.leadStatus },
      select: { id: true, name: true, leadStatus: true },
    });
  },
};
