import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveSpreadsheetTabs } from "@/lib/google/sheets-read";

// Usado por el formulario de alta de una fuente: recibe la URL (o el ID crudo) de
// una hoja de Google Sheets pegada por el usuario y devuelve sus pestañas, para
// construir el resto del formulario de mapeo sin que el usuario tenga que adivinar.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { spreadsheetIdOrUrl } = await req.json();
    if (!spreadsheetIdOrUrl || typeof spreadsheetIdOrUrl !== "string") {
      return NextResponse.json({ error: "Falta la URL o ID de la hoja" }, { status: 400 });
    }

    const result = await resolveSpreadsheetTabs(session.user.id, spreadsheetIdOrUrl);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la hoja — revisa el enlace y que tengas acceso a ella";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
