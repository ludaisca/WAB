import type { WAAccount } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { sendMessage as sendMetaMessage } from "@/lib/whatsapp";
import { getActiveSocket } from "@/lib/whatsapp-baileys/connection-manager";

interface SendParams {
  to: string;
  type: "text" | "image" | "audio" | "video" | "document";
  body?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}

// Unifies outbound sending across both channels so callers (bot-worker,
// campaign-worker, chat send route) don't need to branch on account.channel.
export async function sendWhatsAppMessage(
  account: WAAccount,
  params: SendParams
): Promise<{ wamid: string | null }> {
  if (account.channel === "BAILEYS") {
    if (params.type !== "text" || !params.body) {
      throw new Error("El envío de multimedia todavía no está soportado en cuentas de WhatsApp Web (Baileys)");
    }

    const sock = getActiveSocket(account.id);
    if (!sock) {
      throw new Error("La cuenta de WhatsApp Web no está conectada. Vuelve a escanear el código QR.");
    }

    const result = await sock.sendMessage(params.to, { text: params.body });
    return { wamid: result?.key?.id ?? null };
  }

  if (!account.phoneNumberId || !account.accessToken) {
    throw new Error("Esta cuenta de Meta Cloud API no tiene credenciales configuradas");
  }

  const accessToken = decrypt(account.accessToken);
  const result = await sendMetaMessage(account.phoneNumberId, accessToken, params);
  return { wamid: result.messages[0]?.id ?? null };
}
