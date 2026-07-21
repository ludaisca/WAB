import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sheetExportUpdateSchema, SHEET_EXPORT_FILTERS_SCHEMAS } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { ensureSheetTab } from "@/lib/google/sheet-export-runner";
import { canUseDataset } from "@/lib/whatsapp/sheet-export-access";
import { EXPORT_COLUMNS_BY_DATASET, type SheetExportDataset } from "@/lib/whatsapp/export-columns";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const body = await req.json();
    const parsed = sheetExportUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await prisma.sheetExport.findFirst({ where: { id, userId: session.user.id } });
    if (!existing) {
      return NextResponse.json({ error: "Exportación no encontrada" }, { status: 404 });
    }
    const dataset = existing.dataset as SheetExportDataset;

    // Re-chequeo de rol también en edición — sin esto, un downgrade de rol
    // posterior a la creación no impedía seguir editando (repuntar hoja,
    // cambiar filtros/columnas) un export cuyo dataset ya no le está permitido;
    // solo el próximo sync lo detectaba, no esta ruta.
    if (!canUseDataset(session.user.role, dataset)) {
      return NextResponse.json({ error: "Tu rol no permite editar este tipo de exportación" }, { status: 403 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

    const nextSpreadsheetId = parsed.data.spreadsheetId ?? existing.spreadsheetId;
    const nextSheetName = parsed.data.sheetName ?? existing.sheetName;
    const destinationChanged =
      (parsed.data.spreadsheetId !== undefined && parsed.data.spreadsheetId !== existing.spreadsheetId) ||
      (parsed.data.sheetName !== undefined && parsed.data.sheetName !== existing.sheetName);

    if (destinationChanged) {
      // Mismo criterio fail-fast que POST: si el usuario repunta la exportación
      // a otra hoja/pestaña, valida acceso de escritura ANTES de persistir —
      // si no, el PATCH devolvía 200 aunque la cuenta de Google conectada no
      // pudiera escribir ahí, y el error solo aparecía recién en el próximo sync.
      const sheets = await getGoogleSheetsClientForUser(session.user.id);
      if (!sheets) {
        return NextResponse.json(
          { error: "Conecta tu cuenta de Google en Configuración antes de editar el destino" },
          { status: 400 }
        );
      }
      try {
        await ensureSheetTab(sheets, nextSpreadsheetId, nextSheetName);
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudo escribir en esa hoja";
        return NextResponse.json(
          { error: `${message} — revisa que la hayas compartido con tu cuenta de Google conectada como Editor` },
          { status: 400 }
        );
      }
      data.spreadsheetId = nextSpreadsheetId;
      data.sheetName = nextSheetName;
    }

    // `dataset` es inmutable — columns/filters se revalidan aquí contra el
    // dataset EXISTENTE (no vienen en un discriminated union en el update).
    if (parsed.data.columns !== undefined) {
      const validKeys = new Set(EXPORT_COLUMNS_BY_DATASET[dataset].map((c) => c.key));
      const invalid = parsed.data.columns.filter((k) => !validKeys.has(k));
      if (invalid.length > 0) {
        return NextResponse.json({ error: `Columnas inválidas para este dataset: ${invalid.join(", ")}` }, { status: 400 });
      }
      data.columns = parsed.data.columns;
    }

    if (parsed.data.filters !== undefined) {
      const filtersSchema = SHEET_EXPORT_FILTERS_SCHEMAS[dataset];
      const filtersParsed = filtersSchema.safeParse(parsed.data.filters);
      if (!filtersParsed.success) {
        return NextResponse.json({ error: filtersParsed.error.issues[0].message }, { status: 400 });
      }
      if (filtersParsed.data.accountIds?.length) {
        const accountIds = await getUserAccountIds(session.user.id);
        const invalid = filtersParsed.data.accountIds.filter((aid: string) => !accountIds.includes(aid));
        if (invalid.length > 0) {
          return NextResponse.json({ error: "Una o más cuentas del filtro no te pertenecen" }, { status: 400 });
        }
      }
      data.filters = filtersParsed.data;
    }

    const updated = await prisma.sheetExport.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Esa pestaña de esa hoja ya tiene una exportación configurada (puede ser tuya o de otro usuario con acceso a la hoja)" },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const existing = await prisma.sheetExport.findFirst({ where: { id, userId: session.user.id } });
    if (!existing) {
      return NextResponse.json({ error: "Exportación no encontrada" }, { status: 404 });
    }

    // Solo borra el registro — la data ya escrita en la hoja de Google queda
    // como último snapshot, esta acción no toca la hoja del usuario.
    await prisma.sheetExport.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
