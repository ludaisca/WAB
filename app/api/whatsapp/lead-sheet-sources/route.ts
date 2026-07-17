import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { leadSheetSourceSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { readSheetValues } from "@/lib/google/sheets-read";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";
import { importNewLeadsForSource } from "@/lib/google/lead-sheet-import";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const accountIds = await getUserAccountIds(session.user.id);

    const sources = await prisma.leadSheetSource.findMany({
      where: { waAccountId: { in: accountIds } },
      include: {
        waAccount: { select: { id: true, name: true } },
        waTemplate: { select: { id: true, name: true, language: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = leadSheetSourceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, waAccountId, waTemplateId, spreadsheetId, sheetName, phoneColumn, nameColumn, bodyColumns, headerParam, buttonParam } =
      parsed.data;

    const accountIds = await getUserAccountIds(session.user.id);
    if (!accountIds.includes(waAccountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const template = await prisma.wATemplate.findFirst({
      where: { id: waTemplateId, waAccountId, status: "APPROVED" },
    });
    if (!template) {
      return NextResponse.json({ error: "La plantilla no está aprobada o no existe" }, { status: 400 });
    }

    const expectedParamCount = getTemplateVariables(template.components).bodyParamCount;
    if (bodyColumns.length !== expectedParamCount) {
      return NextResponse.json(
        { error: `La plantilla requiere ${expectedParamCount} variable(s) de cuerpo, se mapearon ${bodyColumns.length}` },
        { status: 400 }
      );
    }

    const sheets = await getGoogleSheetsClientForUser(session.user.id);
    if (!sheets) {
      return NextResponse.json(
        { error: "Conecta tu cuenta de Google en Configuración antes de crear una fuente" },
        { status: 400 }
      );
    }

    const rows = await readSheetValues(sheets, spreadsheetId, sheetName);
    if (rows.length === 0) {
      return NextResponse.json({ error: "La hoja/pestaña indicada está vacía o no existe" }, { status: 400 });
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const missing = [phoneColumn, ...(nameColumn ? [nameColumn] : []), ...bodyColumns].filter(
      (col) => !header.includes(col.trim().toLowerCase())
    );
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `No se encontraron estas columnas en la hoja: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const created = await prisma.leadSheetSource.create({
      data: {
        userId: session.user.id,
        waAccountId,
        waTemplateId,
        name,
        spreadsheetId,
        sheetName,
        phoneColumn,
        nameColumn: nameColumn || null,
        bodyColumns,
        headerParam: headerParam || null,
        buttonParam: buttonParam || null,
      },
    });

    // Necesita las relaciones completas (accessToken de la cuenta, components de la
    // plantilla) para poder sembrar — se piden aparte para no filtrar esos campos
    // sensibles en la respuesta JSON de este endpoint.
    const full = await prisma.leadSheetSource.findUniqueOrThrow({
      where: { id: created.id },
      include: { waAccount: true, waTemplate: true },
    });

    // Marca las filas ya presentes como "vistas" sin enviarles nada — solo se
    // dispara la plantilla a leads que aparezcan después de conectar la fuente.
    try {
      await importNewLeadsForSource(full, { seedOnly: true });
    } catch (err) {
      console.error(`[lead-sheet-sources] Error sembrando filas existentes de la fuente ${created.id}:`, err);
    }

    return NextResponse.json(
      {
        ...created,
        waAccount: { id: full.waAccount.id, name: full.waAccount.name },
        waTemplate: { id: full.waTemplate.id, name: full.waTemplate.name, language: full.waTemplate.language },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
