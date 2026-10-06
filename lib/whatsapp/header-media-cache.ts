import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { saveMediaFromMeta, resolveAbsolutePath } from "@/lib/whatsapp/media-store";

export interface HeaderMediaCopy {
  relativePath: string;
  mimeType: string;
  bytesSize: number;
}

const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS ?? 90);
const REUSE_WINDOW_DAYS = 30;

// La cabecera multimedia de una campaña / fuente de Facebook Ads es la misma
// para todos los destinatarios, y un mismo Media ID se envía en MUCHAS
// corridas (la importación de una fuente corre cada 5 min, una campaña puede
// repetirse). Antes cada corrida volvía a descargar el archivo de Meta y
// guardaba una copia nueva: ~1300 copias en disco con solo ~1000 contenidos
// distintos, y el respaldo diario las empaquetaba todas.
//
// Si ya hay una copia local de ESE Media ID de una corrida reciente, se
// reutiliza (sin ir a Meta). Solo se consideran copias recientes (<30 días —
// el Media ID mismo caduca a los ~30): el job media-cleanup purga por
// antigüedad de mensaje, y apuntar un mensaje nuevo a un archivo a punto de
// purgarse lo dejaría roto. Con una retención configurada ≤30 días el reuso
// se desactiva por la misma razón.
export async function getOrSaveHeaderMedia(
  accountId: string,
  mediaId: string,
  encryptedAccessToken: string
): Promise<HeaderMediaCopy> {
  const reuseAllowed = !(RETENTION_DAYS > 0 && RETENTION_DAYS <= REUSE_WINDOW_DAYS);
  if (reuseAllowed) {
    const since = new Date(Date.now() - REUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const existing = await prisma.wAMessage.findFirst({
      where: {
        mediaId,
        mediaUrl: { not: null },
        direction: "OUTBOUND",
        timestamp: { gte: since },
        chat: { accountId },
      },
      orderBy: { timestamp: "desc" },
      select: { mediaUrl: true, mimeType: true, bytesSize: true },
    });
    if (existing?.mediaUrl) {
      try {
        const stat = await fs.stat(resolveAbsolutePath(existing.mediaUrl));
        return {
          relativePath: existing.mediaUrl,
          mimeType: existing.mimeType ?? "",
          bytesSize: existing.bytesSize ?? stat.size,
        };
      } catch {
        // el archivo ya no está en disco — se descarga de nuevo abajo
      }
    }
  }

  const stored = await saveMediaFromMeta(accountId, mediaId, encryptedAccessToken);
  return { relativePath: stored.relativePath, mimeType: stored.remoteMimeType, bytesSize: stored.bytesSize };
}
