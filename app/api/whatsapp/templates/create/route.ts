import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { templateCreateSchema } from "@/lib/validations";
import { createTemplate } from "@/lib/whatsapp/templates";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";
import { parseBodyParams } from "@/lib/whatsapp/template-variables";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`template-create:${session.user.id}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
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

    // Índice máximo, no cantidad de placeholders distintos — misma lógica que
    // template-variables.ts:parseBodyParams (usada por campañas), así la
    // plantilla pide el número correcto de ejemplos al crearse.
    const bodyVariableCount = parseBodyParams(components.body).count;
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

    // Meta permite el mismo nombre en idiomas distintos como plantillas
    // independientes — el duplicado real es (nombre, idioma), no solo nombre.
    const existing = await prisma.wATemplate.findFirst({
      where: { waAccountId, name, language },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Ya existe una plantilla con el nombre "${name}" en el idioma "${language}" en esta cuenta` },
        { status: 409 }
      );
    }

    const accessToken = decrypt(account.accessToken);

    const result = await createTemplate(account.wabaId, accessToken, parsed.data);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Guarda el arreglo con la forma real de Meta (el mismo `payload.components`
    // que se envió a crear la plantilla), NO el objeto de entrada de Zod —
    // template-variables.ts/TemplatePreview esperan `Array.isArray(components)`
    // con `{type: "HEADER"|"BODY"|"FOOTER"|"BUTTONS", ...}`, la misma forma que
    // produce la sincronización con Meta.
    const template = await prisma.wATemplate.create({
      data: {
        waAccountId: account.id,
        templateId: result.templateId,
        name,
        language,
        category: "MARKETING",
        status: "PENDING",
        components: result.components as object,
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
