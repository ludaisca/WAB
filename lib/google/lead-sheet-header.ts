import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { uploadMedia } from "@/lib/whatsapp";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";
import type { LeadSheetSource, WAAccount } from "@prisma/client";

// Meta borra los medios subidos vía /{phone-number-id}/media a los ~30 días; el
// envío falla entonces con (#131009) "Media ID … does not exist or has expired".
export function isExpiredMediaError(message: string): boolean {
  return /media id .*(does not exist|has expired)/i.test(message);
}

export const HEADER_MEDIA_EXPIRED_MESSAGE =
  "El archivo de la cabecera expiró en Meta y no hay copia local para volver a subirlo — reemplázalo desde el detalle de la fuente";

async function uploadAndStore(
  source: Pick<LeadSheetSource, "id" | "waAccountId">,
  account: WAAccount,
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  if (!account.accessToken || !account.phoneNumberId) {
    throw new Error("La cuenta de WhatsApp no tiene accessToken/phoneNumberId configurados");
  }
  const uploaded = await uploadMedia(account.phoneNumberId, decrypt(account.accessToken), buffer, filename, mimeType);
  await prisma.leadSheetSource.update({ where: { id: source.id }, data: { headerParam: uploaded.id } });
  return uploaded.id;
}

// Sube un archivo nuevo como cabecera de la fuente y devuelve el nuevo media id.
// La copia local para futuras autorreparaciones la deja el importador al enviar.
export function replaceHeaderMedia(
  source: Pick<LeadSheetSource, "id" | "waAccountId">,
  account: WAAccount,
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  return uploadAndStore(source, account, buffer, filename, mimeType);
}

// Autorreparación: reusa la copia local del archivo (guardada la primera vez que
// se envió la cabecera) para subirlo de nuevo y apuntar la fuente al id nuevo.
// Devuelve null si no hay copia utilizable.
export async function refreshHeaderMediaFromLocalCopy(
  source: Pick<LeadSheetSource, "id" | "waAccountId" | "headerParam">,
  account: WAAccount
): Promise<string | null> {
  const previous = await prisma.wAMessage.findFirst({
    where: { leadSheetSourceId: source.id, mediaUrl: { not: null }, mediaId: { not: null } },
    orderBy: { timestamp: "desc" },
    select: { mediaUrl: true, mimeType: true },
  });
  if (!previous?.mediaUrl) return null;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(resolveAbsolutePath(previous.mediaUrl));
  } catch {
    return null; // purgada por media-cleanup
  }
  const mimeType = previous.mimeType ?? "application/octet-stream";
  const ext = previous.mediaUrl.split(".").pop() ?? "bin";
  return uploadAndStore(source, account, buffer, `header-${source.id}.${ext}`, mimeType);
}
