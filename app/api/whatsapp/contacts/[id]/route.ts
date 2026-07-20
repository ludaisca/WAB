import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { contactUpdateSchema } from "@/lib/validations";

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
    const accountIds = await getUserAccountIds(session.user.id);

    const contact = await prisma.contact.findFirst({
      where: { id, accountId: { in: accountIds } },
      select: {
        id: true,
        accountId: true,
        remoteJid: true,
        name: true,
        leadStatus: true,
        optedOutMarketing: true,
        optedOutAt: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        chat: { select: { id: true } },
      },
    });

    if (!contact) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    const accountIds = await getUserAccountIds(session.user.id);

    const existing = await prisma.contact.findFirst({
      where: { id, accountId: { in: accountIds } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = contactUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updated = await prisma.contact.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        accountId: true,
        remoteJid: true,
        name: true,
        leadStatus: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
