import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { resolveAbsolutePath, mediaReadStream } from "@/lib/whatsapp/media-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { messageId } = await params;
    const accountIds = await getUserAccountIds(session.user.id);

    const message = await prisma.wAMessage.findFirst({
      where: { id: messageId, chat: { accountId: { in: accountIds } } },
      select: {
        id: true,
        mediaUrl: true,
        mimeType: true,
        filename: true,
        messageType: true,
        chat: { select: { accountId: true } },
      },
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

    const isInline =
      message.messageType === "image" ||
      message.messageType === "audio" ||
      message.messageType === "video";

    if (!isInline && message.filename) {
      headers.set(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(message.filename)}"`
      );
    } else if (!isInline) {
      headers.set("Content-Disposition", "attachment");
    }

    return new Response(stream as unknown as ReadableStream, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}