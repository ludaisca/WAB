import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const accountIds = await getUserAccountIds(session.user.id);

    const scores = await prisma.wALeadScore.findMany({
      where: { chat: { accountId: { in: accountIds } } },
      include: {
        scorer: { select: { id: true, name: true } },
        chat: {
          select: {
            id: true,
            name: true,
            remoteJid: true,
            status: true,
            accountId: true,
            account: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { score: "desc" },
      take: 500,
    });

    return NextResponse.json(scores);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
