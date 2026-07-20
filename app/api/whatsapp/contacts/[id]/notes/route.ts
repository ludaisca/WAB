import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { noteSchema } from "@/lib/validations";

async function getOwnedContact(userId: string, contactId: string) {
  const accountIds = await getUserAccountIds(userId);
  return prisma.contact.findFirst({
    where: { id: contactId, accountId: { in: accountIds } },
  });
}

export async function GET(
  _req: Request,
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

    const notes = await prisma.wANote.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(notes);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const note = await prisma.wANote.create({
      data: {
        contactId: id,
        authorId: session.user.id,
        body: parsed.data.body,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
