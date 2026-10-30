import { withMaintenanceGuard } from "@/lib/maintenance-guard";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMessageSchema } from "@/lib/validations";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { rateLimit } from "@/lib/rate-limit";
import { assertAccountMediaPath } from "@/lib/whatsapp/media-path";
import { ownsMediaUpload } from "@/lib/whatsapp/media-upload";
import { isWithinServiceWindow } from "@/lib/whatsapp/service-window";
import { describeDecryptError } from "@/lib/crypto";

async function handlePOST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const rl = await rateLimit(`chat-send:${session.user.id}`, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiados mensajes enviados, intenta más tarde" }, { status: 429 });
    }

    const { chatId } = await params;
    const accessWhere = await chatAccessWhere(session.user.id, session.user.role);

    const chat = await prisma.wAChat.findFirst({
      where: { id: chatId, ...accessWhere },
      include: { account: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const isFirstResponse = chat.firstResponseAt === null;

    const body = await req.json();
    const parsed = sendMessageSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0].message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { type, body: textBody, mediaId, caption, mimeType, filename, localMediaPath, bytesSize } = parsed.data;

    if (localMediaPath) {
      try {
        assertAccountMediaPath(chat.account.id, localMediaPath);
      } catch {
        return NextResponse.json({ error: "Archivo no autorizado para esta cuenta" }, { status: 403 });
      }
    }
    if (type === "text" && (localMediaPath || mediaId)) {
      return NextResponse.json({ error: "Un mensaje de texto no puede asociar un archivo" }, { status: 400 });
    }
    if (localMediaPath && !(await ownsMediaUpload(mediaId, {
      userId: session.user.id, accountId: chat.account.id, localMediaPath,
    }))) {
      return NextResponse.json({ error: "La carga no está autorizada o expiró. Vuelve a subir el archivo." }, { status: 403 });
    }

    // Ventana de servicio de Meta: fuera de las 24 h del último mensaje entrante
    // solo se aceptan plantillas aprobadas, y esta ruta no envía plantillas (eso
    // lo hace el worker de campañas). Va después de las validaciones de permisos
    // de media a propósito: una ruta ajena debe seguir devolviendo 403 y no un
    // 409 de ventana. Se corta aquí con un mensaje accionable en vez de dejar
    // que Meta rechace el envío con un error opaco.
    const lastInbound = await prisma.wAMessage.findFirst({
      where: { chatId: chat.id, direction: "INBOUND" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    if (!lastInbound || !isWithinServiceWindow(lastInbound.timestamp, new Date())) {
      return NextResponse.json(
        { error: "La ventana de 24 h de WhatsApp está cerrada. Para reabrir la conversación envía una plantilla aprobada." },
        { status: 409 }
      );
    }

    const result = await sendWhatsAppMessage(chat.account, {
      to: chat.remoteJid,
      type,
      body: textBody,
      mediaId,
      caption,
      mimeType,
      filename,
      localMediaPath,
    });

    const wamid = result.wamid ?? undefined;
    const now = new Date();

    const newMessage = await prisma.wAMessage.create({
      data: {
        wamid,
        chatId: chat.id,
        direction: "OUTBOUND",
        messageType: type,
        body: textBody ?? null,
        caption: caption ?? null,
        mediaId,
        mediaUrl: localMediaPath ?? null,
        mimeType,
        filename,
        bytesSize,
        status: "sent",
        senderId: session.user.id,
        timestamp: now,
      },
    });

    await prisma.wAChat.update({
      where: { id: chat.id },
      data: {
        lastMessage: textBody ?? caption ?? `[${type}]`,
        lastMessageAt: now,
        ...(isFirstResponse ? { firstResponseAt: now } : {}),
      },
    });

    await prisma.wAAccount.update({
      where: { id: chat.account.id },
      data: { lastActivity: now },
    });

    return NextResponse.json(newMessage);
  } catch (error) {
    const message =
      describeDecryptError(error) ??
      (error instanceof Error ? error.message : "Error interno del servidor");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withMaintenanceGuard(handlePOST);
