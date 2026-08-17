import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackedExecutiveUpdateSchema } from "@/lib/validations";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = trackedExecutiveUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const executive = await prisma.trackedExecutive.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(executive);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      if (code === "P2002") return NextResponse.json({ error: "Ya hay un ejecutivo monitoreado con ese teléfono" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { id } = await params;
    // onDelete: Cascade en ExternalProspect — borrar un ejecutivo monitoreado
    // borra también su copia local de prospectos, no solo deja de sincronizar.
    await prisma.trackedExecutive.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
