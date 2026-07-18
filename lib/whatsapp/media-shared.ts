// Helpers de media puros (sin fs/crypto) — importables tanto desde el servidor
// (media-store.ts los re-exporta) como desde componentes cliente
// (chat-workspace.tsx). No agregar aquí nada que dependa de Node builtins.

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

export function mediaEndpointFor(messageId: string): string {
  return `/api/whatsapp/messages/${encodeURIComponent(messageId)}/media`;
}
