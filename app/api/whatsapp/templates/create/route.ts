import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { templateCreateSchema } from "@/lib/validations";
import { createTemplate } from "@/lib/whatsapp/templates";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = templateCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { waAccountId, name, language, components } = parsed.data;

    const bodyVariableCount = new Set(components.body.match(/\{\{(\d+)\}\}/g)).size;
    if (bodyVariableCount > 0 && (components.bodyExamples?.length ?? 0) !== bodyVariableCount) {
      return NextResponse.json(
        { error: `Debes dar un ejemplo para cada variable del cuerpo (${bodyVariableCount} requerido(s))` },
        { status: 400 }
      );
    }

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
        { error: "Esta cuenta no tiene WABA ID configurado. Configúralo antes de crear plantillas." },
        { status: 400 }
      );
    }

    const existing = await prisma.wATemplate.findFirst({
      where: { waAccountId, name },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Ya existe una plantilla con el nombre "${name}" en esta cuenta` },
        { status: 409 }
      );
    }

    const accessToken = decrypt(account.accessToken);

    const result = await createTemplate(account.wabaId, accessToken, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const template = await prisma.wATemplate.create({
      data: {
        waAccountId: account.id,
        templateId: result.templateId,
        name,
        language,
        category: "MARKETING",
        status: "PENDING",
        components: components as object,
        syncedAt: new Date(),
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
