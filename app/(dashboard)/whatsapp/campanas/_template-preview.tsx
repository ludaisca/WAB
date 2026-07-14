"use client";

import { FileText, Video, AlertTriangle, CheckCircle2, CornerUpLeft } from "lucide-react";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text?: string; url?: string }>;
}

interface Props {
  components: unknown;
  // Local (object URL or server) preview of the image the user uploaded for an
  // IMAGE-format header — falls back to a placeholder icon when not provided.
  headerImagePreview?: string | null;
}

// This mirrors WhatsApp's own light chat wallpaper/bubble colors, not the
// dashboard's theme tokens — a template preview shows what the recipient sees
// on their phone, which never changes with our app's light/dark toggle.
const WA = {
  wallpaper: "#e5ddd5",
  bubble: "#ffffff",
  text: "#111b21",
  muted: "#667781",
  mediaPlaceholder: "#e9e9e9",
  accent: "#008069",
  border: "#e9e9e9",
};

function highlightVariables(text: string) {
  const parts = text.split(/(\{\{\s*\d+\s*\}\})/g);
  return parts.map((part, i) =>
    /^\{\{\s*\d+\s*\}\}$/.test(part) ? (
      <span key={i} className="inline-block rounded px-1 text-[10px] font-bold" style={{ background: "rgba(0,128,105,0.12)", color: WA.accent }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function TemplatePreview({ components, headerImagePreview }: Props) {
  const list = Array.isArray(components) ? (components as MetaTemplateComponent[]) : [];
  const header = list.find((c) => c.type === "HEADER");
  const body = list.find((c) => c.type === "BODY");
  const footer = list.find((c) => c.type === "FOOTER");
  const buttonsComponent = list.find((c) => c.type === "BUTTONS");
  const vars = getTemplateVariables(components);

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: WA.wallpaper }}>
        <div className="max-w-[280px] mx-auto rounded-lg rounded-tl-sm shadow-sm overflow-hidden" style={{ background: WA.bubble }}>
          {header && header.format !== "TEXT" && (
            <div className="flex items-center justify-center" style={{ background: WA.mediaPlaceholder, height: 140 }}>
              {header.format === "IMAGE" && (
                headerImagePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL / blob, not an optimizable remote asset
                  <img src={headerImagePreview} alt="Cabecera" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1" style={{ color: WA.muted }}>
                    <FileText size={18} />
                    <span className="text-[10px]">Sin imagen cargada</span>
                  </div>
                )
              )}
              {header.format === "VIDEO" && (
                <div className="flex flex-col items-center gap-1" style={{ color: WA.muted }}>
                  <Video size={18} />
                  <span className="text-[10px]">video</span>
                </div>
              )}
              {header.format === "DOCUMENT" && (
                <div className="flex flex-col items-center gap-1" style={{ color: WA.muted }}>
                  <FileText size={18} />
                  <span className="text-[10px]">documento</span>
                </div>
              )}
            </div>
          )}

          <div className="px-3 py-2.5">
            {header?.format === "TEXT" && (
              <p className="text-xs font-bold mb-1" style={{ color: WA.text }}>
                {header.text ? highlightVariables(header.text) : "(cabecera de texto)"}
              </p>
            )}
            <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: WA.text }}>
              {body?.text ? highlightVariables(body.text) : <span style={{ color: WA.muted }}>(sin cuerpo)</span>}
            </p>
            {footer?.text && (
              <p className="text-[10px] mt-1" style={{ color: WA.muted }}>{footer.text}</p>
            )}
            <p className="text-[10px] text-right mt-1" style={{ color: WA.muted }}>12:00 p.m.</p>
          </div>

          {buttonsComponent?.buttons && buttonsComponent.buttons.length > 0 && (
            <div>
              {buttonsComponent.buttons.map((btn, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-center gap-2 text-xs font-medium py-2.5 border-t"
                  style={{ color: WA.accent, borderColor: WA.border }}
                >
                  <CornerUpLeft size={13} />
                  <span className="truncate">{btn.text || `Botón ${idx + 1}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border text-xs">
        <VariableRow
          label="Cabecera"
          required={vars.header.required}
          detail={
            vars.header.format === null
              ? "Sin cabecera"
              : vars.header.format === "TEXT"
              ? vars.header.required ? "Requiere texto" : "Texto fijo, sin variables"
              : `Requiere ${vars.header.format.toLowerCase()} (archivo)`
          }
        />
        <VariableRow
          label="Cuerpo"
          required={vars.bodyParamCount > 0}
          detail={vars.bodyParamCount > 0 ? `${vars.bodyParamCount} variable(s)` : "Sin variables"}
        />
        <VariableRow
          label="Botones"
          required={!!vars.buttonUrl}
          detail={vars.buttonUrl ? `URL dinámica en "${vars.buttonUrl.text}"` : "Sin variables"}
        />
        <VariableRow
          label="Pie de página"
          required={vars.footerHasVariables}
          detail="Meta no admite variables en el pie de página"
        />
      </div>
    </div>
  );
}

function VariableRow({ label, required, detail }: { label: string; required: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        {required ? (
          <AlertTriangle size={13} className="text-warning shrink-0" />
        ) : (
          <CheckCircle2 size={13} className="text-muted-darker shrink-0" />
        )}
        <span className="font-medium">{label}</span>
      </div>
      <span className="text-muted-darker">{detail}</span>
    </div>
  );
}
