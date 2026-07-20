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
  /**
   * Nombres de los parámetros del body cuando la plantilla usa parámetros CON
   * NOMBRE (`{{nombre}}`), en orden de primera aparición. `null` cuando son
   * posicionales (`{{1}}`). El envío necesita saberlo: Meta exige
   * `parameter_name` en el payload para las plantillas con nombre.
   */
  bodyParamNames: string[] | null;
  buttonUrl: { required: boolean; index: number; text: string } | null;
  footerHasVariables: boolean;
}

// Acepta tanto `{{1}}` como `{{nombre_agente}}` — Meta permite ambos estilos y
// antes solo se detectaban los numéricos.
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function hasVariable(text?: string): boolean {
  return !!text && new RegExp(PLACEHOLDER_RE.source).test(text);
}

/**
 * Devuelve cuántos valores hay que suministrar para el body y, si la plantilla
 * usa parámetros con nombre, cuáles son.
 *
 * Para los posicionales el total es el índice MÁXIMO, no la cantidad de
 * placeholders distintos: una plantilla con `{{1}}` y `{{3}}` necesita 3
 * posiciones aunque solo aparezcan 2 marcadores.
 */
function parseBodyParams(text?: string): { count: number; names: string[] | null } {
  if (!text) return { count: 0, names: null };
  const tokens = [...text.matchAll(new RegExp(PLACEHOLDER_RE.source, "g"))].map((m) => m[1]);
  if (tokens.length === 0) return { count: 0, names: null };

  if (tokens.every((t) => /^\d+$/.test(t))) {
    return { count: Math.max(...tokens.map(Number)), names: null };
  }
  // Con nombre (o mezcla inválida, que Meta rechazaría): se tratan como nombres,
  // sin duplicados y en orden de aparición.
  return { count: new Set(tokens).size, names: [...new Set(tokens)] };
}

interface RenderTemplateTextInput {
  bodyParams?: string[];
  headerParam?: string | null;
}

// Renders the actual text a recipient would read for a template send — substitutes
// {{n}} placeholders positionally, same convention as campaign-worker.ts's
// Object.values(recipient.parameters). Used to store the real message text on
// WAMessage.body instead of a cryptic "Plantilla: X — a, b" placeholder.
export function renderTemplateText(components: unknown, { bodyParams = [], headerParam }: RenderTemplateTextInput): string {
  const list = Array.isArray(components) ? (components as MetaTemplateComponent[]) : [];
  const header = list.find((c) => c.type === "HEADER");
  const body = list.find((c) => c.type === "BODY");

  // Sustituye por posición para `{{1}}` y por nombre para `{{nombre}}` (en el
  // segundo caso bodyParams viene alineado con el orden de bodyParamNames).
  const substitute = (text: string, params: string[], names: string[] | null) =>
    text.replace(new RegExp(PLACEHOLDER_RE.source, "g"), (match, token: string) => {
      if (names) {
        const i = names.indexOf(token);
        return i === -1 ? match : params[i] ?? match;
      }
      return /^\d+$/.test(token) ? params[Number(token) - 1] ?? match : match;
    });

  const parts: string[] = [];
  if (header?.format === "TEXT" && header.text) {
    parts.push(substitute(header.text, headerParam ? [headerParam] : [], null));
  }
  if (body?.text) {
    parts.push(substitute(body.text, bodyParams, parseBodyParams(body.text).names));
  }

  return parts.join("\n\n").trim();
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

  const bodyParams = parseBodyParams(body?.text);

  let buttonUrl: TemplateVariables["buttonUrl"] = null;
  buttonsComponent?.buttons?.forEach((btn, index) => {
    if (btn.type === "URL" && hasVariable(btn.url)) {
      buttonUrl = { required: true, index, text: btn.text ?? `Botón ${index + 1}` };
    }
  });

  return {
    header: { required: headerRequired, format: headerFormat },
    bodyParamCount: bodyParams.count,
    bodyParamNames: bodyParams.names,
    buttonUrl,
    footerHasVariables: hasVariable(footer?.text),
  };
}
