import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campaignQueue } from "@/lib/queue";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const campaign = await prisma.wACampaign.findFirst({
      where: { id, userId: session.user.id },
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

    await prisma.wACampaign.update({
      where: { id },
      data: { status: "SENDING", sentAt: new Date() },
    });

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
