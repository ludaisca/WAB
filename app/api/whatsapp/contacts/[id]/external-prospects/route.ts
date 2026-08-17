import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { phoneKeyFromRemoteJid } from "@/lib/crm-ejecutivos/phone-match";

// Admin-only por decisión de producto (ver CLAUDE.md → "CRM Ejecutivos"): la
// info del CRM externo no se expone a roles user/ejecutivo, ni siquiera como
// badge en este drawer que sí usan. Distinto del resto de rutas de contactos
// (que solo exigen getUserAccountIds()) — el 403 aquí es del feature, no de
// pertenencia del contacto.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const accountIds = await getUserAccountIds(session.user.id);

    const contact = await prisma.contact.findFirst({
      where: { id, accountId: { in: accountIds } },
      select: { remoteJid: true },
    });
    if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

    const key = phoneKeyFromRemoteJid(contact.remoteJid);
    const prospects = await prisma.externalProspect.findMany({
      where: { phoneKey: key },
      orderBy: { sourceUpdatedAt: "desc" },
      include: { trackedExecutive: { select: { label: true } } },
    });

    return NextResponse.json(
      prospects.map((p) => ({
        id: p.id,
        name: p.name,
        product: p.product,
        isOportunity: p.isOportunity,
        isClient: p.isClient,
        rejected: p.rejected,
        discarted: p.discarted,
        lastTrackingReason: p.lastTrackingReason,
        executiveLabel: p.trackedExecutive.label,
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
