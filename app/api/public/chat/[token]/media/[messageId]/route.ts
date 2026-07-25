import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAbsolutePath, mediaReadStream } from "@/lib/whatsapp/media-store";

// Espejo sin auth de /api/whatsapp/messages/[messageId]/media — el gate de
// acceso es que `messageId` pertenezca a un chat cuyo publicShareToken sea
// exactamente `token` (ambos se validan en un único where, no por separado,
// para que un token revocado o de otro chat nunca sirva un archivo).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; messageId: string }> }
) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const { allowed } = await rateLimit(`public-chat-media:${ip}`, 60, 60);
    if (!allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }, { status: 429 });
    }

    const { token, messageId } = await params;

    const message = await prisma.wAMessage.findFirst({
      where: { id: messageId, chat: { publicShareToken: token } },
      select: { mediaUrl: true, mimeType: true, filename: true, messageType: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }
    if (!message.mediaUrl) {
      return NextResponse.json({ error: "Medio no disponible" }, { status: 404 });
    }

    let stat;
    try {
      const { promises: fs } = await import("fs");
      stat = await fs.stat(resolveAbsolutePath(message.mediaUrl));
    } catch {
      return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    }

    const stream = mediaReadStream(message.mediaUrl);
    const headers = new Headers();
    headers.set("Content-Type", message.mimeType ?? "application/octet-stream");
    headers.set("Content-Length", String(stat.size));
    headers.set("Cache-Control", "private, max-age=3600");

    const isInline = message.messageType === "image" || message.messageType === "audio" || message.messageType === "video";
    if (!isInline && message.filename) {
      headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(message.filename)}"`);
    } else if (!isInline) {
      headers.set("Content-Disposition", "attachment");
    }

    return new Response(stream as unknown as ReadableStream, { headers });
  } catch (error) {
    console.error("[api] Error interno:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
