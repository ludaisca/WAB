import { promises as fs } from "fs";
import { createReadStream } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { getMediaUrl } from "@/lib/whatsapp";
import { decrypt } from "@/lib/crypto";

import { mimeTypeToExtension } from "@/lib/whatsapp/media-shared";

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";

// Los helpers puros (mime checks, mediaEndpointFor) viven en media-shared.ts —
// cliente-seguro, sin fs — y se re-exportan aquí para los consumidores de servidor.
export {
  mimeTypeToExtension,
  isImageMime,
  isAudioMime,
  isVideoMime,
  isDocumentMime,
  mediaEndpointFor,
} from "@/lib/whatsapp/media-shared";

async function ensureAccountDir(accountId: string): Promise<string> {
  const dir = path.join(MEDIA_ROOT, accountId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export interface StoredMedia {
  relativePath: string; // e.g. "<accountId>/<uuid>.<ext>" (relative to MEDIA_ROOT)
  absolutePath: string;
  bytesSize: number;
  sha256?: string;
}

async function persistBuffer(
  accountId: string,
  buffer: Buffer,
  mimeType: string | null | undefined
): Promise<StoredMedia> {
  const dir = await ensureAccountDir(accountId);
  const ext = mimeTypeToExtension(mimeType);
  const filename = `${randomUUID()}.${ext}`;
  const absolutePath = path.join(dir, filename);
  const relativePath = path.join(accountId, filename);

  await fs.writeFile(absolutePath, buffer);

  return {
    relativePath,
    absolutePath,
    bytesSize: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export interface DownloadedMetaMedia extends StoredMedia {
  remoteMimeType: string;
  remoteUrl: string;
}

export async function saveMediaFromMeta(
  accountId: string,
  mediaId: string,
  encryptedAccessToken: string
): Promise<DownloadedMetaMedia> {
  const accessToken = decrypt(encryptedAccessToken);
  const { url, mimeType } = await getMediaUrl(mediaId, accessToken);

  // Meta's lookaside.fbsbx.com download URL isn't a public pre-signed link — it still
  // requires the same Bearer token used to resolve it, or the byte download 401s even
  // though the metadata lookup above (same token) succeeded.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Descarga de medio Meta fallida (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const stored = await persistBuffer(accountId, buf, mimeType);

  return {
    ...stored,
    remoteMimeType: mimeType,
    remoteUrl: url,
  };
}

export async function saveMediaFromBuffer(
  accountId: string,
  buffer: Buffer,
  mimeType: string | null | undefined
): Promise<StoredMedia> {
  return persistBuffer(accountId, buffer, mimeType);
}

export function resolveAbsolutePath(relativePath: string): string {
  const safe = path.normalize(relativePath).replace(/^(\.\.\/?)+/, "");
  const root = path.resolve(MEDIA_ROOT);
  const resolved = path.resolve(root, safe);
  // Defensa en profundidad: aunque `mediaUrl` viene de la DB (no de input directo),
  // se verifica que la ruta resuelta no escape de MEDIA_ROOT antes de leer bytes.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Ruta de medio fuera del directorio permitido");
  }
  return resolved;
}

export function mediaReadStream(relativePath: string) {
  const abs = resolveAbsolutePath(relativePath);
  return createReadStream(abs);
}