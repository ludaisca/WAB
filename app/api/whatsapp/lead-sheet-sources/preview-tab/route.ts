import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { readSheetValues } from "@/lib/google/sheets-read";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { spreadsheetId, sheetName } = await req.json();
    if (!spreadsheetId || !sheetName) {
      return NextResponse.json({ error: "Falta spreadsheetId o sheetName" }, { status: 400 });
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
      return NextResponse.json({ error: "Esa pestaña está vacía" }, { status: 400 });
    }

    return NextResponse.json({ header: rows[0], sampleRow: rows[1] ?? null, rowCount: Math.max(rows.length - 1, 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la pestaña";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
