import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserApiKey } from "@/lib/ai/settings";
import { listOpenRouterModels, listGoogleModels } from "@/lib/ai/models";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider");

    if (provider !== "openrouter" && provider !== "google") {
      return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
    }

    if (provider === "google") {
      const apiKey = await getUserApiKey(session.user.id, "google");
      if (!apiKey) {
        return NextResponse.json(
          { error: "Configura tu API key de Google en Configuración > IA" },
          { status: 400 }
        );
      }
      const models = await listGoogleModels(apiKey);
      return NextResponse.json(models);
    }

    const apiKey = await getUserApiKey(session.user.id, "openrouter");
    const models = await listOpenRouterModels(apiKey ?? undefined);
    return NextResponse.json(models);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
