import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";

// Lista negra de contactos ("solo automatización"): bloquea/desbloquea un
// Contacto por cuenta. Bloquear detiene el bot, campañas, lead-recovery,
// lead-scoring y la importación de hojas para ese contacto — sus mensajes se
// siguen guardando, notificando y pueden responderse manualmente.
const blockSchema = z.object({
  action: z.enum(["block", "unblock"]),
  note: z.string().max(500).optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const rl = await rateLimit(`contact-block:${session.user.id}`, 30, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes — intenta de nuevo en un minuto" },
        { status: 429 }
      );
    }

    const { id } = await params;
    const accountIds = await getUserAccountIds(session.user.id);

    const contact = await prisma.contact.findFirst({
      where: { id, accountId: { in: accountIds } },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { action, note } = parsed.data;
    const updated = await prisma.contact.update({
      where: { id },
      data:
        action === "block"
          ? { blockedAt: new Date(), blockedNote: note?.trim() || null }
          : { blockedAt: null, blockedNote: null },
      select: { id: true, blockedAt: true, blockedNote: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
