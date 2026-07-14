// Meta's Resumable Upload API — the only way to get a `header_handle` usable in
// `example.header_handle` when creating a message template with a media header.
// Distinct from lib/whatsapp.ts:uploadMedia() (the /{phone-number-id}/media
// endpoint), which returns a media ID usable only for *sending* messages/already
// approved templates, not for template *creation*.

const GRAPH_API = "https://graph.facebook.com/v21.0";

interface MetaError {
  error?: { message?: string; error_user_msg?: string };
}

export async function uploadTemplateHeaderMedia(
  appId: string,
  accessToken: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const sessionRes = await fetch(
    `${GRAPH_API}/${appId}/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(mimeType)}&access_token=${encodeURIComponent(accessToken)}`,
    { method: "POST" }
  );
  const sessionJson = (await sessionRes.json().catch(() => ({}))) as { id?: string } & MetaError;

  if (!sessionRes.ok || !sessionJson.id) {
    const msg = sessionJson.error?.error_user_msg ?? sessionJson.error?.message ?? "Error al iniciar la subida a Meta";
    throw new Error(msg);
  }

  const uploadRes = await fetch(`${GRAPH_API}/${sessionJson.id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: "0",
    },
    body: new Uint8Array(buffer),
  });
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as { h?: string } & MetaError;

  if (!uploadRes.ok || !uploadJson.h) {
    const msg = uploadJson.error?.error_user_msg ?? uploadJson.error?.message ?? "Error al subir el archivo a Meta";
    throw new Error(msg);
  }

  return uploadJson.h;
}
