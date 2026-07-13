import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { getUserAccountIds } from "@/lib/shared-accounts";

async function syncTemplatesFromMeta(wabaId: string, accessToken: string) {
  const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? "Error al sincronizar plantillas");
  }

  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      status: string;
      components: unknown[];
    }>;
  };

  return data.data ?? [];
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

    const { waAccountId } = (await req.json()) as { waAccountId: string };

    const account = await prisma.wAAccount.findFirst({
      where: { id: waAccountId, userId: session.user.id },
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

    const accessToken = decrypt(account.accessToken);
    const metaTemplates = await syncTemplatesFromMeta(
      account.wabaId,
      accessToken
    );

    for (const t of metaTemplates) {
      await prisma.wATemplate.upsert({
        where: {
          waAccountId_templateId: {
            waAccountId: account.id,
            templateId: t.id,
          },
        },
        create: {
          waAccountId: account.id,
          templateId: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components as object,
          syncedAt: new Date(),
        },
        update: {
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components as object,
          syncedAt: new Date(),
        },
      });
    }

    const syncedIds = metaTemplates.map((t) => t.id);
    await prisma.wATemplate.deleteMany({
      where: {
        waAccountId: account.id,
        templateId: { notIn: syncedIds },
      },
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
