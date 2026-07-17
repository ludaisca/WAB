import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadSheetSourceUpdateSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const accountIds = await getUserAccountIds(session.user.id);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id, waAccountId: { in: accountIds } },
      include: {
        waAccount: { select: { id: true, name: true } },
        waTemplate: { select: { id: true, name: true, language: true } },
      },
    });
    if (!source) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    const rowCounts = await prisma.leadSheetImportedRow.groupBy({
      by: ["status"],
      where: { sourceId: id },
      _count: { _all: true },
    });

    const recentRows = await prisma.leadSheetImportedRow.findMany({
      where: { sourceId: id },
      orderBy: { importedAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ ...source, rowCounts, recentRows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const body = await req.json();
    const parsed = leadSheetSourceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    const existing = await prisma.leadSheetSource.findFirst({ where: { id, waAccountId: { in: accountIds } } });
    if (!existing) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    const updated = await prisma.leadSheetSource.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const accountIds = await getUserAccountIds(session.user.id);
    const existing = await prisma.leadSheetSource.findFirst({ where: { id, waAccountId: { in: accountIds } } });
    if (!existing) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    await prisma.leadSheetSource.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
