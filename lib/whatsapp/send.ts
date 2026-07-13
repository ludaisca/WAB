import type { WAAccount } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { sendMessage as sendMetaMessage } from "@/lib/whatsapp";

interface SendParams {
  to: string;
  type: "text" | "image" | "audio" | "video" | "document";
  body?: string;
  mediaId?: string | null;
  mimeType?: string;
  caption?: string;
  filename?: string;
  localMediaPath?: string | null;
}

// Unified outbound sender for Meta Cloud API accounts.
export async function sendWhatsAppMessage(
  account: WAAccount,
  params: SendParams
): Promise<{ wamid: string | null }> {
  if (!account.phoneNumberId || !account.accessToken) {
    throw new Error("Esta cuenta no tiene credenciales de Meta Cloud API configuradas");
  }

  const accessToken = decrypt(account.accessToken);
  const result = await sendMetaMessage(account.phoneNumberId, accessToken, {
    ...params,
    mediaId: params.mediaId ?? undefined,
  });
  return { wamid: result.messages[0]?.id ?? null };
}
