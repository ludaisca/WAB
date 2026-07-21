import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campaignQueue } from "@/lib/queue";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`campaign-send:${session.user.id}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados envíos en poco tiempo — intenta de nuevo en un minuto" },
        { status: 429 }
      );
    }

    const { id } = await params;

    const accountIds = await getUserAccountIds(session.user.id);
    const campaign = await prisma.wACampaign.findFirst({
      where: { id, waAccountId: { in: accountIds } },
      include: { waTemplate: { select: { status: true } } },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaña no encontrada" },
        { status: 404 }
      );
    }

    if (campaign.status === "SENDING" || campaign.status === "COMPLETED") {
      return NextResponse.json(
        { error: "La campaña ya está en envío o completada" },
        { status: 400 }
      );
    }

    // Revalida el status actual de la plantilla — pudo aprobarse al crear la
    // campaña y ser rechazada/pausada por Meta después, antes de este envío.
    if (campaign.waTemplate.status !== "APPROVED") {
      return NextResponse.json(
        { error: "La plantilla ya no está aprobada — sincroniza plantillas y vuelve a intentar" },
        { status: 400 }
      );
    }

    // Claim atómico condicionado al estado: dos clics simultáneos en "Enviar"
    // ya no encolan dos veces la misma campaña.
    const claimed = await prisma.wACampaign.updateMany({
      where: { id, status: { notIn: ["SENDING", "COMPLETED"] } },
      data: { status: "SENDING", sentAt: new Date() },
    });
    if (claimed.count === 0) {
      return NextResponse.json(
        { error: "La campaña ya está en envío o completada" },
        { status: 400 }
      );
    }

    await campaignQueue.add("send", { campaignId: id });

    return NextResponse.json({
      success: true,
      message: "Campaña encolada para envío",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
