import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const riskTier = searchParams.get("riskTier");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const where: Prisma.AgentActionWhereInput = { userId: session.user.id };
  if (status) where.status = status as never;
  if (riskTier) where.riskTier = riskTier;
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    };
  }

  const actions = await prisma.agentAction.findMany({
    where,
    include: { resolvedBy: { select: { name: true, email: true } }, conversation: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(actions);
}
