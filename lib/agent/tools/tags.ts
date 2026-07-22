import { prisma } from "@/lib/prisma";
import type { ToolDefinition } from "./types";

export const tagsList: ToolDefinition<Record<string, never>> = {
  name: "tags.list",
  riskTier: "READ",
  description: "Lista el catálogo global de etiquetas (tags) usadas en contactos y chats.",
  parameters: { type: "object", properties: {} },
  handler: async () => {
    const tags = await prisma.tag.findMany({
      select: { id: true, name: true, color: true, _count: { select: { contacts: true, chats: true } } },
      orderBy: { name: "asc" },
    });
    return { tags };
  },
};
