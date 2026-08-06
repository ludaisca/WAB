import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";
import type { ScoreDetails } from "@/lib/whatsapp/export-columns";

export interface ActivityEvent {
  id: string;
  kind:
    | "contact_created"
    | "note"
    | "chat_created"
    | "first_response"
    | "resolved"
    | "campaign"
    | "recovery"
    | "blocked"
    | "opted_out"
    | "conversation";
  at: string;
  title: string;
  description?: string;
  href?: string;
}

export interface QualifiedDataEntry {
  botId: string;
  botName: string;
  summary: string | null;
  qualifiedData: Record<string, unknown> | null;
}

export interface ChatScoreEntry {
  scorerId: string;
  scorerName: string;
  score: number;
  label: string;
  summary: string;
  details: ScoreDetails | null;
  updatedAt: string;
}

export interface ContactActivity {
  events: ActivityEvent[];
  qualified: QualifiedDataEntry[];
  scores: ChatScoreEntry[];
}

// El timeline combina datos de dos niveles de acceso distintos y por eso
// valida dos veces: el Contact en sí solo necesita getUserAccountIds() (igual
// que el resto de rutas de contactos), pero todo lo que cuelga del CHAT
// (qualifiedData de bots, scores de calificadores, mensajes atribuidos a
// campaña) DEBE re-validarse vía chatAccessWhere() — es el mismo criterio que
// ya protege /api/whatsapp/chats/[chatId]/* y respeta `hideUnattributedChats`.
// Sin este segundo check, un rol con esa opción activada podría ver por este
// endpoint datos que su inbox le oculta a propósito (ver AGENTS.md).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const accountIds = await getUserAccountIds(session.user.id);

    const contact = await prisma.contact.findFirst({
      where: { id, accountId: { in: accountIds } },
      select: {
        id: true,
        createdAt: true,
        blockedAt: true,
        optedOutAt: true,
        chat: { select: { id: true } },
        notes: {
          orderBy: { createdAt: "desc" },
          select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
        },
      },
    });

    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const events: ActivityEvent[] = [
      { id: `contact-${contact.id}`, kind: "contact_created", at: contact.createdAt.toISOString(), title: "Contacto creado" },
      ...contact.notes.map((n) => ({
        id: `note-${n.id}`,
        kind: "note" as const,
        at: n.createdAt.toISOString(),
        title: `Nota de ${n.author.name ?? "usuario"}`,
        description: n.body,
      })),
    ];
    if (contact.blockedAt) {
      events.push({ id: `blocked-${contact.id}`, kind: "blocked", at: contact.blockedAt.toISOString(), title: "Contacto bloqueado" });
    }
    if (contact.optedOutAt) {
      events.push({ id: `optout-${contact.id}`, kind: "opted_out", at: contact.optedOutAt.toISOString(), title: "Se dio de baja de marketing" });
    }

    let qualified: QualifiedDataEntry[] = [];
    let scores: ChatScoreEntry[] = [];

    if (contact.chat) {
      const accessWhere = await chatAccessWhere(session.user.id, session.user.role);
      const chat = await prisma.wAChat.findFirst({
        where: { id: contact.chat.id, ...accessWhere },
        select: {
          id: true,
          accountId: true,
          createdAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          lastMessageAt: true,
          messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
          botConversations: {
            select: {
              botId: true,
              bot: { select: { name: true } },
              summary: true,
              qualifiedData: true,
            },
          },
          leadScores: {
            select: {
              scorerId: true,
              scorer: { select: { name: true } },
              score: true,
              label: true,
              summary: true,
              details: true,
              updatedAt: true,
            },
          },
          recoveryAttempts: {
            select: { id: true, attemptNumber: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      });

      // chat null aquí = el Contact existe y es mío, pero el chat que cuelga
      // de él está fuera de mi chatAccessWhere (hideUnattributedChats) — no es
      // un error, solo significa que esta sección del timeline queda vacía.
      if (chat) {
        events.push({ id: `chat-${chat.id}`, kind: "chat_created", at: chat.createdAt.toISOString(), title: "Primer mensaje recibido" });
        if (chat.firstResponseAt) {
          events.push({ id: `firstresp-${chat.id}`, kind: "first_response", at: chat.firstResponseAt.toISOString(), title: "Primera respuesta enviada" });
        }
        if (chat.resolvedAt) {
          events.push({ id: `resolved-${chat.id}`, kind: "resolved", at: chat.resolvedAt.toISOString(), title: "Chat marcado como resuelto" });
        }
        const attribution = resolveChatAttribution(chat.messages);
        if (attribution) {
          events.push({
            id: `attr-${chat.id}`,
            kind: "campaign",
            at: chat.createdAt.toISOString(),
            title: `Atribuido a ${attribution.name}`,
            description: attribution.origin === "manual" ? "Campaña masiva" : "Automatización de Sheets",
          });
        }
        for (const r of chat.recoveryAttempts) {
          events.push({
            id: `recovery-${r.id}`,
            kind: "recovery",
            at: r.createdAt.toISOString(),
            title: `Intento de reactivación #${r.attemptNumber}`,
          });
        }
        if (chat._count.messages > 0) {
          events.push({
            id: `conv-${chat.id}`,
            kind: "conversation",
            at: (chat.lastMessageAt ?? chat.createdAt).toISOString(),
            title: `Conversación · ${chat._count.messages} mensaje(s)`,
            href: `/whatsapp/chat/${chat.accountId}/${chat.id}`,
          });
        }

        // Hallazgo más valioso del audit: qualifiedData/summary se recopila en
        // cada conversación real vía la tool registrar_dato_prospecto y hasta
        // ahora no aparecía en ningún lado de la UI. WABotConversation no
        // tiene timestamps (ver schema), así que esto es un bloque de estado
        // en la pestaña Resumen, no un evento cronológico del timeline.
        qualified = chat.botConversations
          .filter((c) => c.summary || (c.qualifiedData && Object.keys(c.qualifiedData as object).length > 0))
          .map((c) => ({
            botId: c.botId,
            botName: c.bot.name,
            summary: c.summary,
            qualifiedData: c.qualifiedData as Record<string, unknown> | null,
          }));

        scores = chat.leadScores.map((s) => ({
          scorerId: s.scorerId,
          scorerName: s.scorer.name,
          score: s.score,
          label: s.label,
          summary: s.summary,
          details: s.details as ScoreDetails | null,
          updatedAt: s.updatedAt.toISOString(),
        }));
      }
    }

    events.sort((a, b) => b.at.localeCompare(a.at));

    const payload: ContactActivity = { events, qualified, scores };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
