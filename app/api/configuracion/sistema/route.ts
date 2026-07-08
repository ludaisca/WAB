import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    let config = await prisma.systemConfig.findUnique({ where: { id: "default" } });

    if (!config) {
      config = await prisma.systemConfig.create({ data: { id: "default" } });
    }

    return NextResponse.json({
      allowRegistration: config.allowRegistration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { allowRegistration } = (await req.json()) as {
      allowRegistration?: boolean;
    };

    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        allowRegistration: allowRegistration ?? true,
      },
      update: {
        ...(allowRegistration !== undefined ? { allowRegistration } : {}),
      },
    });

    return NextResponse.json({
      allowRegistration: config.allowRegistration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
