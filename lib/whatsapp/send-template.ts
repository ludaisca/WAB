import { decrypt } from "@/lib/crypto";
import type { WAAccount } from "@prisma/client";

export interface SendTemplateParams {
  to: string;
  templateName: string;
  language: string;
  bodyParams?: string[];
  /**
   * Nombres de los parámetros del body cuando la plantilla usa parámetros CON
   * NOMBRE (`{{nombre}}`), alineados por índice con `bodyParams`. Meta rechaza
   * esas plantillas si el payload no lleva `parameter_name`. Omitir (o null)
   * para plantillas posicionales (`{{1}}`).
   */
  bodyParamNames?: string[] | null;
  headerFormat?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  // TEXT header → texto plano; IMAGE/VIDEO/DOCUMENT → Meta media id (no una URL).
  headerParam?: string | null;
  buttonIndex?: number | null;
  buttonParam?: string | null;
}

// Único lugar que construye un payload type:"template" para la Graph API — usado por
// campaign-worker.ts (envío masivo) y lib/google/lead-sheet-import.ts (envío disparado
// por una fila nueva en una hoja externa). Lanza Error(mensaje) en fallo; cada caller
// decide cómo registrar ese fallo (WACampaignRecipient.FAILED, LeadSheetImportedRow, etc.).
export async function sendTemplateMessage(
  account: WAAccount,
  params: SendTemplateParams
): Promise<{ wamid: string | null }> {
  if (!account.accessToken || !account.phoneNumberId) {
    throw new Error("La cuenta de WhatsApp no tiene accessToken/phoneNumberId configurados");
  }
  const accessToken = decrypt(account.accessToken);
  const phoneNumberId = account.phoneNumberId;

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: "template",
    template: { name: params.templateName, language: { code: params.language } },
  };

  const templateComponents: Record<string, unknown>[] = [];

  if (params.bodyParams && params.bodyParams.length > 0) {
    const names = params.bodyParamNames;
    templateComponents.push({
      type: "body",
      parameters: params.bodyParams.map((text, i) =>
        names?.[i] ? { type: "text", parameter_name: names[i], text } : { type: "text", text }
      ),
    });
  }

  if (params.headerParam && params.headerFormat) {
    if (params.headerFormat === "TEXT") {
      templateComponents.push({
        type: "header",
        parameters: [{ type: "text", text: params.headerParam }],
      });
    } else {
      const mediaType = params.headerFormat.toLowerCase();
      templateComponents.push({
        type: "header",
        parameters: [{ type: mediaType, [mediaType]: { id: params.headerParam } }],
      });
    }
  }

  if (params.buttonParam && params.buttonIndex !== null && params.buttonIndex !== undefined) {
    templateComponents.push({
      type: "button",
      sub_type: "url",
      index: String(params.buttonIndex),
      parameters: [{ type: "text", text: params.buttonParam }],
    });
  }

  if (templateComponents.length > 0) {
    (body.template as Record<string, unknown>).components = templateComponents;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  let res = await fetch(url, requestInit);

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "5");
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    res = await fetch(url, requestInit);
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message =
      (errorBody as { error?: { message?: string } })?.error?.message ?? `Error HTTP ${res.status}`;
    throw new Error(message);
  }

  const responseData = (await res.json()) as { messages?: Array<{ id: string }> };
  return { wamid: responseData?.messages?.[0]?.id ?? null };
}
