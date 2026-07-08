import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Este email ya está registrado." },
        { status: 409 }
      );
    }

    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });

    if (!config.allowRegistration) {
      return NextResponse.json(
        { error: "El registro de usuarios está deshabilitado." },
        { status: 403 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const userCount = await prisma.user.count();
    const role = userCount === 0 ? "admin" : "user";

    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
