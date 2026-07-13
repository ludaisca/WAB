const API_VERSION = "v21.0";
const BASE_URL = "https://graph.facebook.com";

interface SendMessageParams {
  to: string;
  type: "text" | "image" | "audio" | "video" | "document";
  body?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}

interface SendMessageResponse {
  messagingProduct: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  codeVerificationStatus: string;
  qualityRating: string;
}

export async function validateToken(
  phoneNumberId: string,
  accessToken: string
): Promise<PhoneNumberInfo> {
  const url = `${BASE_URL}/${API_VERSION}/${phoneNumberId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message ?? `Token validation failed (HTTP ${res.status})`
    );
  }

  return res.json() as Promise<PhoneNumberInfo>;
}

export async function sendMessage(
  phoneNumberId: string,
  accessToken: string,
  params: SendMessageParams
): Promise<SendMessageResponse> {
  const url = `${BASE_URL}/${API_VERSION}/${phoneNumberId}/messages`;

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: params.type,
  };

  if (params.type === "text") {
    payload.text = { body: params.body ?? "", preview_url: false };
  } else {
    payload[params.type] = {
      ...(params.mediaId ? { id: params.mediaId } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
      ...(params.mimeType ? { mime_type: params.mimeType } : {}),
      ...(params.filename ? { filename: params.filename } : {}),
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message ?? `Send message failed (HTTP ${res.status})`
    );
  }

  return res.json() as Promise<SendMessageResponse>;
}

export async function getMediaUrl(
  mediaId: string,
  accessToken: string
): Promise<{ url: string; mimeType: string }> {
  const res = await fetch(`${BASE_URL}/${API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message ?? `Get media failed (HTTP ${res.status})`
    );
  }

  return res.json() as Promise<{ url: string; mimeType: string }>;
}

export interface UploadedMedia {
  id: string;
}

export async function uploadMedia(
  phoneNumberId: string,
  accessToken: string,
  file: File | Buffer,
  filename: string,
  mimeType: string
): Promise<UploadedMedia> {
  const url = `${BASE_URL}/${API_VERSION}/${phoneNumberId}/media`;

  const formData = new FormData();
  if (file instanceof File) {
    formData.append("file", file, filename);
  } else {
    const blob = new Blob([new Uint8Array(file)], { type: mimeType });
    formData.append("file", blob, filename);
  }
  formData.append("messaging_product", "whatsapp");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message ?? `Upload media failed (HTTP ${res.status})`
    );
  }

  return res.json() as Promise<UploadedMedia>;
}
