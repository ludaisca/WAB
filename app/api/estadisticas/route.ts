import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEstadisticas } from "@/lib/estadisticas/get-stats";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const stats = await getEstadisticas(session.user.id);
    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
