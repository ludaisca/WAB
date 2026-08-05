import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserApiKey } from "@/lib/ai/settings";
import { listGoogleModels } from "@/lib/ai/models";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const apiKey = await getUserApiKey(session.user.id);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configura tu API key de Google en Configuración > IA" },
        { status: 400 }
      );
    }
    const models = await listGoogleModels(apiKey);
    return NextResponse.json(models);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
