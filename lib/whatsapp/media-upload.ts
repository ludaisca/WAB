import { getRedisClient } from "@/lib/redis";

interface MediaUploadReceipt {
  userId: string;
  accountId: string;
  localMediaPath: string | null;
}

const keyFor = (mediaId: string) => `wab:media-upload:${mediaId}`;

// mediaId ya viaja del upload al composer: se usa como recibo, sin añadir
// tokens al cliente ni confiar en una ruta escrita por el navegador.
export async function rememberMediaUpload(mediaId: string, receipt: MediaUploadReceipt): Promise<void> {
  await getRedisClient().set(keyFor(mediaId), JSON.stringify(receipt), "EX", 24 * 60 * 60);
}

export async function ownsMediaUpload(mediaId: string | null | undefined, receipt: MediaUploadReceipt): Promise<boolean> {
  if (!mediaId) return false;
  const stored = await getRedisClient().get(keyFor(mediaId));
  if (!stored) return false;
  try {
    const value = JSON.parse(stored) as MediaUploadReceipt;
    return value.userId === receipt.userId && value.accountId === receipt.accountId &&
      value.localMediaPath === receipt.localMediaPath;
  } catch {
    return false;
  }
}
