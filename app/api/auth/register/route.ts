import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    const { allowed } = await rateLimit(`register:${ip}`, 5, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta de nuevo en un minuto." },
        { status: 429 }
      );
    }
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    // El check de registro deshabilitado va ANTES que el de email existente —
    // al revés, el endpoint confirmaba qué emails existen (enumeración) incluso
    // con el registro cerrado.
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

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Este email ya está registrado." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count();
      const role = userCount === 0 ? "admin" : "user";

      return tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
        },
      });
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
