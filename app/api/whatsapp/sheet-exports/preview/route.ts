import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveSpreadsheetTabs } from "@/lib/google/sheets-read";

// Mismo cuerpo que app/api/whatsapp/lead-sheet-sources/preview/route.ts (ambas
// delegan en el helper compartido) — namespace propio para que el formulario
// de exportaciones no dependa de una ruta de una feature distinta.
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

    const result = await resolveSpreadsheetTabs(session.user.id, spreadsheetIdOrUrl);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la hoja — revisa el enlace y que tengas acceso a ella";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
