import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

// Herramienta de mantenimiento de UN SOLO USO — fusiona pares de WAChat/Contact
// duplicados por el quirk de WhatsApp para números mexicanos: un envío en frío
// (campaña manual o automatización de Sheets) creaba el chat bajo remoteJid
// "52XXXXXXXXXX" (número tal cual), pero cuando el lead responde, el webhook
// lo hace bajo "521XXXXXXXXXX" (wa_id canónico que reporta Meta) — dos chats
// para el mismo lead. lib/whatsapp/send-template.ts ya se corrigió para que
// esto no vuelva a pasar en envíos nuevos (captura contacts[0].wa_id de la
// respuesta de Meta); esta ruta arregla los pares que ya quedaron duplicados.
// Se elimina después de usarse una vez — no es una feature permanente.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { allowed } = await rateLimit(`merge-twin-chats:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

  const { execute } = (await req.json().catch(() => ({}))) as { execute?: boolean };

  const pairs = await prisma.$queryRawUnsafe<
    Array<{
      chatAutoId: string;
      chatRealId: string;
      contactAutoId: string | null;
      contactRealId: string | null;
      accountId: string;
      jidAuto: string;
      jidReal: string;
      origen: "manual" | "automatizacion";
    }>
  >(`
    SELECT DISTINCT
      a.id AS "chatAutoId", b.id AS "chatRealId",
      a."contactId" AS "contactAutoId", b."contactId" AS "contactRealId",
      a."accountId" AS "accountId", a."remoteJid" AS "jidAuto", b."remoteJid" AS "jidReal",
      CASE WHEN ma."campaignId" IS NOT NULL THEN 'manual' ELSE 'automatizacion' END AS origen
    FROM wa_chats a
    JOIN wa_messages ma ON ma."chatId" = a.id AND (ma."campaignId" IS NOT NULL OR ma."leadSheetSourceId" IS NOT NULL)
    JOIN wa_chats b ON b."accountId" = a."accountId" AND b.id <> a.id
      AND right(a."remoteJid", 10) = right(b."remoteJid", 10)
    JOIN wa_messages mb ON mb."chatId" = b.id AND mb.direction = 'INBOUND'
    WHERE NOT EXISTS (
      SELECT 1 FROM wa_messages mx WHERE mx."chatId" = a.id AND mx.direction = 'INBOUND'
    )
  `);

  const results: Array<{ pair: (typeof pairs)[number]; status: "merged" | "error"; error?: string }> = [];

  if (execute) {
    for (const pair of pairs) {
      try {
        await mergePair(pair);
        results.push({ pair, status: "merged" });
      } catch (err) {
        results.push({ pair, status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return NextResponse.json({
    execute: !!execute,
    totalPairs: pairs.length,
    pairs: execute ? results : pairs.map((pair) => ({ pair, status: "pending" as const })),
  });
}

async function mergePair(pair: {
  chatAutoId: string;
  chatRealId: string;
  contactAutoId: string | null;
  contactRealId: string | null;
}) {
  const { chatAutoId, chatRealId, contactAutoId, contactRealId } = pair;

  await prisma.$transaction(async (tx) => {
    const messages = await tx.wAMessage.findMany({ where: { chatId: chatAutoId } });
    for (const m of messages) {
      try {
        await tx.wAMessage.update({ where: { id: m.id }, data: { chatId: chatRealId } });
      } catch {
        // colisión de @@unique([chatId, wamid]) — se deja en chatAuto, se
        // pierde con el chat al borrarlo (onDelete: Cascade); caso extremadamente raro.
      }
    }

    const chatTags = await tx.chatTag.findMany({ where: { chatId: chatAutoId } });
    for (const t of chatTags) {
      const exists = await tx.chatTag.findUnique({ where: { chatId_tagId: { chatId: chatRealId, tagId: t.tagId } } });
      if (exists) {
        await tx.chatTag.delete({ where: { chatId_tagId: { chatId: chatAutoId, tagId: t.tagId } } });
      } else {
        await tx.chatTag.update({
          where: { chatId_tagId: { chatId: chatAutoId, tagId: t.tagId } },
          data: { chatId: chatRealId },
        });
      }
    }

    const scores = await tx.wALeadScore.findMany({ where: { chatId: chatAutoId } });
    for (const s of scores) {
      const exists = await tx.wALeadScore.findUnique({
        where: { chatId_scorerId: { chatId: chatRealId, scorerId: s.scorerId } },
      });
      if (exists) {
        await tx.wALeadScore.delete({ where: { id: s.id } });
      } else {
        await tx.wALeadScore.update({ where: { id: s.id }, data: { chatId: chatRealId } });
      }
    }

    await tx.wALeadRecoveryAttempt.updateMany({ where: { chatId: chatAutoId }, data: { chatId: chatRealId } });

    const convs = await tx.wABotConversation.findMany({ where: { waChatId: chatAutoId } });
    for (const c of convs) {
      const exists = await tx.wABotConversation.findUnique({
        where: { botId_waChatId: { botId: c.botId, waChatId: chatRealId } },
      });
      if (exists) {
        await tx.wABotConversation.delete({ where: { id: c.id } });
      } else {
        await tx.wABotConversation.update({ where: { id: c.id }, data: { waChatId: chatRealId } });
      }
    }

    await tx.wALeadScorerUsage.updateMany({ where: { waChatId: chatAutoId }, data: { waChatId: chatRealId } });
    await tx.wABotUsage.updateMany({ where: { waChatId: chatAutoId }, data: { waChatId: chatRealId } });

    if (contactAutoId && contactRealId && contactAutoId !== contactRealId) {
      const contactTags = await tx.contactTag.findMany({ where: { contactId: contactAutoId } });
      for (const t of contactTags) {
        const exists = await tx.contactTag.findUnique({
          where: { contactId_tagId: { contactId: contactRealId, tagId: t.tagId } },
        });
        if (exists) {
          await tx.contactTag.delete({ where: { contactId_tagId: { contactId: contactAutoId, tagId: t.tagId } } });
        } else {
          await tx.contactTag.update({
            where: { contactId_tagId: { contactId: contactAutoId, tagId: t.tagId } },
            data: { contactId: contactRealId },
          });
        }
      }
      await tx.wANote.updateMany({ where: { contactId: contactAutoId }, data: { contactId: contactRealId } });
    }

    const latest = await tx.wAMessage.findFirst({
      where: { chatId: chatRealId },
      orderBy: { timestamp: "desc" },
      select: { body: true, timestamp: true },
    });
    if (latest) {
      await tx.wAChat.update({
        where: { id: chatRealId },
        data: { lastMessage: latest.body ? latest.body.slice(0, 500) : null, lastMessageAt: latest.timestamp },
      });
    }

    await tx.wAChat.delete({ where: { id: chatAutoId } });
    if (contactAutoId && contactAutoId !== contactRealId) {
      await tx.contact.delete({ where: { id: contactAutoId } }).catch(() => {});
    }
  });
}
