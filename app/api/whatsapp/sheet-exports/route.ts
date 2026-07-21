import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sheetExportCreateSchema } from "@/lib/validations";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { ensureSheetTab, syncSingleExport } from "@/lib/google/sheet-export-runner";
import { canUseDataset } from "@/lib/whatsapp/sheet-export-access";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Ownership directo por userId — GoogleAccount ya es 1:1 por usuario, a
    // diferencia de LeadSheetSource (que cuelga de una WAAccount compartible).
    const exports = await prisma.sheetExport.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(exports);
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
    const parsed = sheetExportCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, dataset, spreadsheetId, sheetName, columns, filters } = parsed.data;

    if (!canUseDataset(session.user.role, dataset)) {
      return NextResponse.json({ error: "Tu rol no permite crear este tipo de exportación" }, { status: 403 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    if (filters.accountIds?.length) {
      const invalid = filters.accountIds.filter((id) => !accountIds.includes(id));
      if (invalid.length > 0) {
        return NextResponse.json({ error: "Una o más cuentas del filtro no te pertenecen" }, { status: 400 });
      }
    }

    const sheets = await getGoogleSheetsClientForUser(session.user.id);
    if (!sheets) {
      return NextResponse.json(
        { error: "Conecta tu cuenta de Google en Configuración antes de crear una exportación" },
        { status: 400 }
      );
    }

    // Falla rápido si la cuenta de Google conectada no puede escribir en esa
    // hoja — antes de persistir nada, mismo criterio que lead-sheet-sources.
    try {
      await ensureSheetTab(sheets, spreadsheetId, sheetName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo escribir en esa hoja";
      return NextResponse.json(
        { error: `${message} — revisa que la hayas compartido con tu cuenta de Google conectada como Editor` },
        { status: 400 }
      );
    }

    const created = await prisma.sheetExport.create({
      data: { userId: session.user.id, name, dataset, spreadsheetId, sheetName, columns, filters },
    });

    // Primera corrida sincrónica, best-effort: si falla no bloquea el alta (la
    // fila ya quedó creada y correcta, solo la corrida puntual falló) — queda
    // lastSyncError para que la UI lo muestre, y el próximo tick reintenta.
    try {
      await syncSingleExport(session.user.id, created.id);
    } catch (err) {
      console.error(`[sheet-exports] Error en la primera corrida del export ${created.id}:`, err);
    }

    const withStatus = await prisma.sheetExport.findUniqueOrThrow({ where: { id: created.id } });
    return NextResponse.json(withStatus, { status: 201 });
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
