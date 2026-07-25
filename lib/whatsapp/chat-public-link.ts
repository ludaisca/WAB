// Link público de solo lectura (/c/[token]) para un WAChat — pensado para
// pegarse en la columna "Link público" de la exportación de leads calificados
// (CSV y sync a Google Sheets, ver export-columns.ts) sin exigir login a quien
// lo abre. El token es un valor propio, generado aparte del cuid del chat,
// para poder revocarlo/regenerarlo sin tocar el id real usado en el resto de
// la app. Nunca se genera al crear el chat — solo bajo demanda (botón en el
// header o primera exportación que lo necesite) para no dejar miles de chats
// existentes con un link listo sin que nadie lo haya pedido.
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function publicChatPath(token: string): string {
  return `/c/${token}`;
}

export function publicChatUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}${publicChatPath(token)}`;
}

// Reintenta en la colisión (astronómicamente improbable con 24 bytes
// aleatorios, pero @unique la puede rechazar) en vez de dejarla reventar.
async function setNewToken(chatId: string, attempts = 3): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const token = generateToken();
    try {
      await prisma.wAChat.update({ where: { id: chatId }, data: { publicShareToken: token } });
      return token;
    } catch (err) {
      const isCollision = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isCollision || i === attempts - 1) throw err;
    }
  }
  throw new Error("No se pudo generar un token único");
}

export async function ensurePublicChatToken(chatId: string): Promise<string> {
  const chat = await prisma.wAChat.findUnique({ where: { id: chatId }, select: { publicShareToken: true } });
  if (chat?.publicShareToken) return chat.publicShareToken;
  return setNewToken(chatId);
}

export async function revokePublicChatToken(chatId: string): Promise<void> {
  await prisma.wAChat.update({ where: { id: chatId }, data: { publicShareToken: null } });
}

// Variante bulk para exportaciones (CSV / Sheets sync): recibe los chats ya
// cargados por el caller (evita una query redundante) y solo escribe para los
// que aún no tienen token. Secuencial a propósito — el volumen es acotado
// (leads calificados de una página/export, no toda la tabla) y así no hace
// falta lidiar con colisiones concurrentes de setNewToken en paralelo.
export async function ensurePublicChatTokensForChats(
  chats: { id: string; publicShareToken: string | null }[]
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (const chat of chats) {
    tokens.set(chat.id, chat.publicShareToken ?? (await setNewToken(chat.id)));
  }
  return tokens;
}
