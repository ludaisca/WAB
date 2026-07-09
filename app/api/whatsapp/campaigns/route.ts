import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campaignSchema } from "@/lib/validations";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = campaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, waAccountId, waTemplateId, scheduledAt, recipients } =
      parsed.data;

    const [account, template] = await Promise.all([
      prisma.wAAccount.findFirst({
        where: { id: waAccountId, userId: session.user.id },
      }),
      prisma.wATemplate.findFirst({
        where: { id: waTemplateId, waAccountId, status: "APPROVED" },
      }),
    ]);

    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }
    if (!template) {
      return NextResponse.json(
        { error: "La plantilla no está aprobada o no existe" },
        { status: 400 }
      );
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.wACampaign.create({
        data: {
          userId: session.user.id,
          waAccountId,
          waTemplateId,
          name,
          status: scheduledAt ? "SCHEDULED" : "DRAFT",
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          recipientCount: recipients.length,
        },
        include: {
          waAccount: { select: { id: true, name: true, phoneNumber: true } },
          waTemplate: { select: { id: true, name: true } },
        },
      });

      await tx.wACampaignRecipient.createMany({
        data: recipients.map((r) => ({
          campaignId: created.id,
          phoneNumber: r.phoneNumber,
          contactName: r.contactName ?? undefined,
          parameters: r.parameters ?? undefined,
        })),
      });

      return created;
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const campaigns = await prisma.wACampaign.findMany({
      where: { userId: session.user.id },
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
        waTemplate: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(campaigns);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
