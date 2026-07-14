// Parses the raw Meta Graph API template `components` shape (as synced/stored on
// WATemplate.components) to detect which parts of a template need a value filled
// in before it can be sent. Shared between the campaign creation UI (client) and
// campaign-worker.ts (server) so both agree on button index / header format.

interface MetaTemplateButton {
  type: string; // QUICK_REPLY | URL | PHONE_NUMBER
  text?: string;
  url?: string;
}

interface MetaTemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT (HEADER only)
  text?: string;
  buttons?: MetaTemplateButton[];
}

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export interface TemplateVariables {
  header: { required: boolean; format: HeaderFormat | null };
  bodyParamCount: number;
  buttonUrl: { required: boolean; index: number; text: string } | null;
  footerHasVariables: boolean;
}

function hasVariable(text?: string): boolean {
  return !!text && /\{\{\s*\d+\s*\}\}/.test(text);
}

export function getTemplateVariables(components: unknown): TemplateVariables {
  const list = Array.isArray(components) ? (components as MetaTemplateComponent[]) : [];

  const header = list.find((c) => c.type === "HEADER");
  const body = list.find((c) => c.type === "BODY");
  const footer = list.find((c) => c.type === "FOOTER");
  const buttonsComponent = list.find((c) => c.type === "BUTTONS");

  const headerFormat = (header?.format as HeaderFormat | undefined) ?? null;
  // Text headers only need a value when they actually contain a {{n}} placeholder.
  // Media headers (IMAGE/VIDEO/DOCUMENT) always need a link supplied at send time —
  // there's no static fallback, Meta rejects the send without one.
  const headerRequired = headerFormat === "TEXT" ? hasVariable(header?.text) : headerFormat !== null;

  const bodyMatches = body?.text ? new Set(body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []) : new Set<string>();

  let buttonUrl: TemplateVariables["buttonUrl"] = null;
  buttonsComponent?.buttons?.forEach((btn, index) => {
    if (btn.type === "URL" && hasVariable(btn.url)) {
      buttonUrl = { required: true, index, text: btn.text ?? `Botón ${index + 1}` };
    }
  });

  return {
    header: { required: headerRequired, format: headerFormat },
    bodyParamCount: bodyMatches.size,
    buttonUrl,
    footerHasVariables: hasVariable(footer?.text),
  };
}
