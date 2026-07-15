import { promises as fs } from "fs";
import { createReadStream } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { getMediaUrl } from "@/lib/whatsapp";
import { decrypt } from "@/lib/crypto";

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/ogg; codecs=opus": "ogg",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
};

export function mimeTypeToExtension(mimeType: string | null | undefined): string {
  if (!mimeType) return "bin";
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? "bin";
}

export function isImageMime(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith("image/");
}

export function isAudioMime(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith("audio/");
}

export function isVideoMime(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith("video/");
}

export function isDocumentMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return (
    m.startsWith("application/") ||
    m.startsWith("text/") ||
    m === "application/pdf"
  );
}

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
  return path.join(MEDIA_ROOT, safe);
}

export function mediaReadStream(relativePath: string) {
  const abs = resolveAbsolutePath(relativePath);
  return createReadStream(abs);
}

export function mediaEndpointFor(messageId: string): string {
  return `/api/whatsapp/messages/${encodeURIComponent(messageId)}/media`;
}