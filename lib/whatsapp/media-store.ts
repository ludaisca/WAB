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

  // Meta a veces responde sin content-type en el metadata del media (típico en
  // cabeceras de plantilla subidas por la Resumable Upload API). Antes ese hueco
  // se guardaba como mime vacío: el archivo quedaba como `.bin` y el WAMessage se
  // creaba con mimeType null, tipo "document" por defecto. Se resuelve aquí, en
  // orden: metadata de Meta → content-type de la descarga → magic bytes → binario
  // genérico. Así ningún mensaje nuevo nace sin mime.
  const contentLengthType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const effectiveMime = mimeType || contentLengthType || detectMimeFromBuffer(buf) || "application/octet-stream";
  const stored = await persistBuffer(accountId, buf, effectiveMime);

  return {
    ...stored,
    remoteMimeType: effectiveMime,
    remoteUrl: url,
  };
}

// Firma de bytes para los formatos que maneja WhatsApp. Devuelve null cuando no
// reconoce el contenido; el caller decide el fallback.
function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString("ascii");

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(4, 8) === "ftyp") return "video/mp4";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "application/zip";
  return null;
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