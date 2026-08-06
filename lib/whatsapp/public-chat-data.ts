// Fuente única de la data que ve /c/[token] — usada tanto por el Server
// Component de la página (carga inicial, sin roundtrip extra) como por
// GET /api/public/chat/[token] (la API pública que consumiría cualquier
// refresh futuro). Mismo patrón que dashboard/page.tsx + su API equivalente:
// una sola función construye el shape, ninguno de los dos consumidores lo
// duplica a mano.
import { prisma } from "@/lib/prisma";

export interface PublicChatMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  body: string | null;
  caption: string | null;
  mimeType: string | null;
  filename: string | null;
  bytesSize: number | null;
  transcription: string | null;
  reaction: string | null;
  status: string | null;
  timestamp: string;
  hasMedia: boolean;
}

export interface PublicChatData {
  name: string;
  phone: string | null;
  accountName: string;
  messages: PublicChatMessage[];
}

export async function getPublicChatData(token: string): Promise<PublicChatData | null> {
  const chat = await prisma.wAChat.findUnique({
    where: { publicShareToken: token },
    select: {
      name: true,
      remoteJid: true,
      isGroup: true,
      account: { select: { name: true } },
      messages: {
        orderBy: { timestamp: "asc" },
        select: {
          id: true,
          direction: true,
          messageType: true,
          body: true,
          caption: true,
          mimeType: true,
          filename: true,
          bytesSize: true,
          transcription: true,
          reaction: true,
          status: true,
          timestamp: true,
          // No se expone mediaUrl (ruta en disco) ni mediaId (id de Meta) — el
          // cliente solo necesita saber SI hay un archivo, y lo pide por
          // messageId a la ruta pública de media.
          mediaUrl: true,
        },
      },
    },
  });

  if (!chat) return null;

  return {
    name: chat.name || chat.remoteJid.split("@")[0],
    phone: chat.isGroup ? null : chat.remoteJid.split("@")[0],
    accountName: chat.account.name,
    messages: chat.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      messageType: m.messageType,
      body: m.body,
      caption: m.caption,
      mimeType: m.mimeType,
      filename: m.filename,
      bytesSize: m.bytesSize,
      transcription: m.transcription,
      reaction: m.reaction,
      status: m.status,
      timestamp: m.timestamp.toISOString(),
      hasMedia: !!m.mediaUrl,
    })),
  };
}
