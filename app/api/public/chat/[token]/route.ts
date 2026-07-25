import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getPublicChatData } from "@/lib/whatsapp/public-chat-data";

// Sin auth a propósito — esta es la API que alimenta /c/[token], la vista
// pública de solo lectura de un chat (ver lib/whatsapp/chat-public-link.ts).
// El token en sí es el único control de acceso: 24 bytes aleatorios, no
// adivinable por fuerza bruta razonable, pero por eso mismo se limita la tasa
// de intentos por IP igual que cualquier otro endpoint sin sesión.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const { allowed } = await rateLimit(`public-chat:${ip}`, 30, 60);
    if (!allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }, { status: 429 });
    }

    const { token } = await params;
    const data = await getPublicChatData(token);
    if (!data) {
      return NextResponse.json({ error: "Link no válido o revocado" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[api] Error interno:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
