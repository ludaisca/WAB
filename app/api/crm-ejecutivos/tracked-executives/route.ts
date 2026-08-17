import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackedExecutiveSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const executives = await prisma.trackedExecutive.findMany({
      orderBy: { label: "asc" },
      include: { _count: { select: { prospects: true } } },
    });
    return NextResponse.json(executives);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = trackedExecutiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const executive = await prisma.trackedExecutive.create({
      data: parsed.data,
    });
    return NextResponse.json(executive, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya hay un ejecutivo monitoreado con ese teléfono" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
