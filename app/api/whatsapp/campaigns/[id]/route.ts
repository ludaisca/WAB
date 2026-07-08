import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
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
      select: {
        id: true,
        name: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        completedAt: true,
        recipientCount: true,
        sentCount: true,
        deliveredCount: true,
        readCount: true,
        failedCount: true,
        createdAt: true,
        updatedAt: true,
        waAccount: { select: { id: true, name: true, phoneNumber: true } },
        waTemplate: { select: { id: true, name: true, components: true } },
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaña no encontrada" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page")) || 1;
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
    const skip = (page - 1) * limit;

    const [recipients, totalRecipients] = await Promise.all([
      prisma.wACampaignRecipient.findMany({
        where: { campaignId: id },
        orderBy: { phoneNumber: "asc" },
        skip,
        take: limit,
      }),
      prisma.wACampaignRecipient.count({ where: { campaignId: id } }),
    ]);

    return NextResponse.json({
      ...campaign,
      recipients,
      recipientsPagination: {
        page,
        limit,
        total: totalRecipients,
        totalPages: Math.ceil(totalRecipients / limit),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
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

    if (campaign.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Solo se pueden eliminar campañas en borrador" },
        { status: 400 }
      );
    }

    await prisma.wACampaign.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
