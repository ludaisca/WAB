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
// que aún no tienen token.
//
// Secuencial NO: un export de "Leads calificados" trae ~12k scores y la primera
// corrida mintaba un token por chat uno detrás de otro dentro del job de sync.
// Se usa un pool acotado (20 en paralelo) y se deduplica por id de chat, porque
// un mismo chat puede aparecer varias veces (un WALeadScore por calificador) y
// sin dedupe se generaban dos tokens, el segundo pisando al primero.
const TOKEN_MINT_CONCURRENCY = 20;

export async function ensurePublicChatTokensForChats(
  chats: { id: string; publicShareToken: string | null }[]
): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  const pending = new Map<string, string | null>();
  for (const chat of chats) {
    if (tokens.has(chat.id) || pending.has(chat.id)) continue;
    if (chat.publicShareToken) tokens.set(chat.id, chat.publicShareToken);
    else pending.set(chat.id, null);
  }

  const queue = Array.from(pending.keys());
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= queue.length) return;
      const chatId = queue[index];
      tokens.set(chatId, await setNewToken(chatId));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(TOKEN_MINT_CONCURRENCY, queue.length) }, worker)
  );

  return tokens;
}
