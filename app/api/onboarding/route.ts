import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { onboardingSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";

// Only runs once, right after a fresh deploy: creates the first admin user
// and the business name shown in the sidebar. Rejected once any user exists —
// after that, new users go through the normal /register flow.
export async function POST(req: Request) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    const { allowed } = await rateLimit(`onboarding:${ip}`, 5, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta de nuevo en un minuto." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = onboardingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, email, password, businessName } = parsed.data;
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count();
      if (userCount > 0) {
        throw new Error("ALREADY_ONBOARDED");
      }

      await tx.user.create({
        data: { name, email, password: hashedPassword, role: "admin" },
      });

      await tx.systemConfig.upsert({
        where: { id: "default" },
        create: { id: "default", businessName },
        update: { businessName },
      });
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_ONBOARDED") {
      return NextResponse.json(
        { error: "El sistema ya fue configurado. Inicia sesión normalmente." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Este email ya está registrado." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
