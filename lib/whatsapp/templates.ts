import type { TemplateCreateInput } from "@/lib/validations";

const GRAPH_API = "https://graph.facebook.com/v21.0";

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: { header_handle: string[] } | { body_text: string[][] };
  buttons?: MetaButton[];
}

interface MetaButton {
  type: string;
  text: string;
  url?: string;
}

interface MetaTemplatePayload {
  name: string;
  language: string;
  category: string;
  components: MetaTemplateComponent[];
}

interface MetaError {
  error?: { message?: string; error_user_msg?: string };
}

function buildPayload(input: TemplateCreateInput): MetaTemplatePayload {
  const components: MetaTemplateComponent[] = [];

  if (input.components.header) {
    const h = input.components.header;
    if (h.format === "TEXT") {
      components.push({ type: "HEADER", format: "TEXT", text: h.text });
    } else {
      components.push({
        type: "HEADER",
        format: h.format,
        example: { header_handle: [h.exampleHandle ?? ""] },
      });
    }
  }

  const bodyVariableCount = new Set(input.components.body.match(/\{\{(\d+)\}\}/g)).size;
  if (bodyVariableCount > 0) {
    components.push({
      type: "BODY",
      text: input.components.body,
      example: { body_text: [input.components.bodyExamples ?? []] },
    });
  } else {
    components.push({ type: "BODY", text: input.components.body });
  }

  if (input.components.footer) {
    components.push({ type: "FOOTER", text: input.components.footer });
  }

  if (input.components.buttons && input.components.buttons.length > 0) {
    const buttons: MetaButton[] = input.components.buttons.map((b) => {
      if (b.type === "URL") {
        return { type: "URL", text: b.text, url: b.url ?? "" };
      }
      return { type: "QUICK_REPLY", text: b.text };
    });
    components.push({ type: "BUTTONS", buttons });
  }

  return {
    name: input.name,
    language: input.language,
    category: "MARKETING",
    components,
  };
}

export async function createTemplate(
  wabaId: string,
  accessToken: string,
  input: TemplateCreateInput
): Promise<{ success: true; templateId: string; components: object } | { success: false; error: string }> {
  const payload = buildPayload(input);

  const url = `${GRAPH_API}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
  } & MetaError;

  if (!res.ok) {
    const msg = json.error?.error_user_msg ?? json.error?.message ?? "Error al crear la plantilla en Meta";
    return { success: false, error: msg };
  }

  if (!json.id) {
    return { success: false, error: "Meta no retornó un ID de plantilla" };
  }

  return {
    success: true,
    templateId: json.id,
    components: payload.components,
  };
}
