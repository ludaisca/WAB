import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { listSheetTabs, extractSpreadsheetId } from "@/lib/google/sheets-read";

// Usado por el formulario de alta de una fuente: recibe la URL (o el ID crudo) de
// una hoja de Google Sheets pegada por el usuario y devuelve sus pestañas, para
// construir el resto del formulario de mapeo sin que el usuario tenga que adivinar.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { spreadsheetIdOrUrl } = await req.json();
    if (!spreadsheetIdOrUrl || typeof spreadsheetIdOrUrl !== "string") {
      return NextResponse.json({ error: "Falta la URL o ID de la hoja" }, { status: 400 });
    }

    const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
    if (!spreadsheetId) {
      return NextResponse.json({ error: "No se pudo identificar el ID de la hoja" }, { status: 400 });
    }

    const sheets = await getGoogleSheetsClientForUser(session.user.id);
    if (!sheets) {
      return NextResponse.json(
        { error: "Conecta tu cuenta de Google en Configuración antes de crear una fuente" },
        { status: 400 }
      );
    }

    const tabs = await listSheetTabs(sheets, spreadsheetId);
    if (tabs.length === 0) {
      return NextResponse.json({ error: "No se encontraron pestañas en esa hoja" }, { status: 400 });
    }

    return NextResponse.json({ spreadsheetId, tabs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la hoja — revisa el enlace y que tengas acceso a ella";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
