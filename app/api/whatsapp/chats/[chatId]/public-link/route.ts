import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { ensurePublicChatToken, revokePublicChatToken, publicChatUrl } from "@/lib/whatsapp/chat-public-link";

async function getOwnedChat(userId: string, role: string | undefined, chatId: string) {
  return prisma.wAChat.findFirst({
    where: { id: chatId, ...(await chatAccessWhere(userId, role)) },
    select: { id: true, publicShareToken: true },
  });
}

// GET: estado actual (existe o no un link activo) sin generarlo.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { chatId } = await params;
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      url: chat.publicShareToken ? publicChatUrl(chat.publicShareToken) : null,
    });
  } catch (error) {
    console.error("[api] Error interno:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST: genera el link si no existe (idempotente — reutiliza el token vigente).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { chatId } = await params;
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const token = await ensurePublicChatToken(chatId);
    return NextResponse.json({ url: publicChatUrl(token) });
  } catch (error) {
    console.error("[api] Error interno:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE: revoca el link vigente — cualquiera con la URL vieja pierde acceso
// de inmediato. Un POST posterior genera un token nuevo, distinto al revocado.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { chatId } = await params;
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    await revokePublicChatToken(chatId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api] Error interno:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
