import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { cannedResponseSchema } from "@/lib/validations";

async function getOwnedCannedResponse(userId: string, id: string) {
  const accountIds = await getUserAccountIds(userId);
  return prisma.cannedResponse.findFirst({
    where: { id, waAccountId: { in: accountIds } },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getOwnedCannedResponse(session.user.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Respuesta rápida no encontrada" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = cannedResponseSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updated = await prisma.cannedResponse.update({
      where: { id },
      data: {
        ...(parsed.data.shortcut ? { shortcut: parsed.data.shortcut } : {}),
        ...(parsed.data.content ? { content: parsed.data.content } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe un atajo con ese nombre en esta cuenta" }, { status: 409 });
    }
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
    const existing = await getOwnedCannedResponse(session.user.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Respuesta rápida no encontrada" }, { status: 404 });
    }

    await prisma.cannedResponse.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
