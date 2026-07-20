import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { waAccountSchema } from "@/lib/validations";
import { encrypt, hashToken } from "@/lib/crypto";
import { validateToken } from "@/lib/whatsapp";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // Alta de números reservada al admin: los demás roles solo acceden a
    // cuentas que se les compartieron (WAAccountShare), nunca propias.
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = waAccountSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0].message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { name, phoneNumberId, accessToken, wabaId, appId, verifyToken, appSecret } =
      parsed.data;

    const validateResult = await validateToken(phoneNumberId, accessToken);

    const encryptedToken = encrypt(accessToken);
    const resolvedVerifyToken = verifyToken || randomBytes(24).toString("hex");
    const verifyHash = hashToken(resolvedVerifyToken);

    const account = await prisma.wAAccount.create({
      data: {
        userId: session.user.id,
        name,
        phoneNumberId,
        accessToken: encryptedToken,
        verifyTokenHash: verifyHash,
        phoneNumber: validateResult.displayPhoneNumber,
        wabaId: wabaId || validateResult.id,
        appId: appId || null,
        appSecret: appSecret ? encrypt(appSecret) : null,
        status: "CONNECTED",
        lastActivity: new Date(),
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        phoneNumberId: true,
        wabaId: true,
        status: true,
        lastActivity: true,
        createdAt: true,
      },
    });

    // verifyToken is only ever stored hashed — this is the one response where the
    // caller can see the plaintext value, since it must be copied into Meta's webhook config.
    return NextResponse.json({ ...account, verifyToken: resolvedVerifyToken }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    const status = message.includes("Token validation failed") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    const userId = session.user.id;

    const sharedIds = await prisma.wAAccountShare.findMany({
      where: { userId },
      select: { waAccountId: true },
    });

    const where: Record<string, unknown> = {
      OR: [
        { userId },
        ...(sharedIds.length > 0 ? [{ id: { in: sharedIds.map((s) => s.waAccountId) } }] : []),
      ],
    };
    if (statusFilter) {
      where.status = statusFilter;
    }

    const accounts = await prisma.wAAccount.findMany({
      where,
      select: {
        id: true,
        name: true,
        channel: true,
        phoneNumber: true,
        phoneNumberId: true,
        wabaId: true,
        userId: true,
        status: true,
        errorMessage: true,
        lastActivity: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { chats: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
