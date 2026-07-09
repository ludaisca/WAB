import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

async function getOwnedContact(userId: string, contactId: string) {
  const accountIds = await getUserAccountIds(userId);
  return prisma.contact.findFirst({
    where: { id: contactId, accountId: { in: accountIds } },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const contact = await getOwnedContact(session.user.id, id);
    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const tagId = body?.tagId;
    if (!tagId || typeof tagId !== "string") {
      return NextResponse.json({ error: "tagId es requerido" }, { status: 400 });
    }

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) {
      return NextResponse.json({ error: "Etiqueta no encontrada" }, { status: 404 });
    }

    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: id, tagId } },
      create: { contactId: id, tagId },
      update: {},
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const contact = await getOwnedContact(session.user.id, id);
    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const tagId = searchParams.get("tagId");
    if (!tagId) {
      return NextResponse.json({ error: "tagId es requerido" }, { status: 400 });
    }

    await prisma.contactTag.deleteMany({ where: { contactId: id, tagId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
