import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";
import { syncAccountTemplates } from "@/lib/whatsapp/template-sync";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const waAccountId = searchParams.get("waAccountId");

    if (!waAccountId) {
      return NextResponse.json(
        { error: "waAccountId es requerido" },
        { status: 400 }
      );
    }

    const accountIds = await getUserAccountIds(session.user.id);

    if (!accountIds.includes(waAccountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const templates = await prisma.wATemplate.findMany({
      where: { waAccountId },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(templates);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`template-sync:${session.user.id}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
    }

    const { waAccountId } = (await req.json()) as { waAccountId: string };

    const accountIds = await getUserAccountIds(session.user.id);

    if (!accountIds.includes(waAccountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const account = await prisma.wAAccount.findFirst({
      where: { id: waAccountId },
    });

    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    if (account.channel !== "META_CLOUD" || !account.wabaId || !account.accessToken) {
      return NextResponse.json(
        { error: "Sincronizar plantillas solo aplica a cuentas de Meta Cloud API con WABA ID configurado" },
        { status: 400 }
      );
    }

    await syncAccountTemplates({
      id: account.id,
      wabaId: account.wabaId,
      accessToken: account.accessToken,
    });

    const templates = await prisma.wATemplate.findMany({
      where: { waAccountId: account.id },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(templates);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
