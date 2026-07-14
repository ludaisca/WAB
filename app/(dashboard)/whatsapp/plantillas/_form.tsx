"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Type, Plus, X, Upload } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
import { RadioGroup } from "@/app/components/ui/radio";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";
import { TemplatePreview } from "@/app/components/whatsapp/template-preview";

interface Account { id: string; name: string; wabaId: string | null; }

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "es_AR", label: "Español (Argentina)" },
  { code: "es_MX", label: "Español (México)" },
  { code: "es_CO", label: "Español (Colombia)" },
  { code: "es_PE", label: "Español (Perú)" },
  { code: "es_CL", label: "Español (Chile)" },
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "pt_BR", label: "Português (Brasil)" },
  { code: "pt_PT", label: "Português (Portugal)" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ar", label: "العربية" },
  { code: "zh_CN", label: "中文 (简体)" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

const HEADER_TYPES = [
  { value: "TEXT", label: "Texto", description: "Título o encabezado de texto" },
  { value: "IMAGE", label: "Imagen", description: "Archivo de imagen de ejemplo" },
  { value: "VIDEO", label: "Video", description: "Archivo de video de ejemplo" },
  { value: "DOCUMENT", label: "Documento", description: "Archivo de documento de ejemplo" },
];

interface ButtonDef {
  type: "QUICK_REPLY" | "URL";
  text: string;
  url?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  defaultAccountId?: string;
  onCreated: () => void;
}

export function TemplateFormModal({ open, onClose, accounts, defaultAccountId = "", onCreated }: Props) {
  const { success, error: toastError } = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headerFileInputRef = useRef<HTMLInputElement>(null);

  const [waAccountId, setWaAccountId] = useState(defaultAccountId);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es");
  const [headerEnabled, setHeaderEnabled] = useState(false);
  const [headerFormat, setHeaderFormat] = useState<"TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT">("TEXT");
  const [headerText, setHeaderText] = useState("");
  const [headerExampleHandle, setHeaderExampleHandle] = useState("");
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState<string | null>(null);
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [headerUploading, setHeaderUploading] = useState(false);
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<ButtonDef[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetForm = useCallback(() => {
    setWaAccountId(defaultAccountId);
    setName("");
    setLanguage("es");
    setHeaderEnabled(false);
    setHeaderFormat("TEXT");
    setHeaderText("");
    setHeaderExampleHandle("");
    if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
    setHeaderPreviewUrl(null);
    setHeaderFileName(null);
    setBody("");
    setFooter("");
    setButtons([]);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets on close, header cleanup is intentionally not a dependency
  }, [defaultAccountId]);

  function handleHeaderFormatChange(format: typeof headerFormat) {
    setHeaderFormat(format);
    setHeaderExampleHandle("");
    if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
    setHeaderPreviewUrl(null);
    setHeaderFileName(null);
  }

  async function handleHeaderFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !waAccountId) return;

    if (headerFormat === "IMAGE") {
      if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
      setHeaderPreviewUrl(URL.createObjectURL(file));
    }
    setHeaderFileName(file.name);
    setHeaderUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("waAccountId", waAccountId);
      const res = await fetch("/api/whatsapp/templates/upload-media", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al subir el archivo");
      setHeaderExampleHandle(data.handle);
      success("Archivo de ejemplo cargado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al subir el archivo");
      setHeaderExampleHandle("");
      setHeaderFileName(null);
      if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
      setHeaderPreviewUrl(null);
    } finally {
      setHeaderUploading(false);
    }
  }

  function insertVariable() {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const count = (body.match(/\{\{\d+\}\}/g) || []).length;
    const cursor = textarea.selectionStart ?? body.length;
    const before = body.slice(0, cursor);
    const after = body.slice(textarea.selectionEnd ?? cursor);
    const v = `{{${count + 1}}}`;
    setBody(before + v + after);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = cursor + v.length;
      textarea.selectionEnd = cursor + v.length;
    }, 0);
  }

  function addButton() {
    setButtons((prev) => [...prev, { type: "QUICK_REPLY", text: "" }]);
  }

  function removeButton(idx: number) {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateButton(idx: number, field: keyof ButtonDef, value: string) {
    setButtons((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b))
    );
  }

  const previewComponents = useMemo(() => {
    const comps: unknown[] = [];
    if (headerEnabled) {
      comps.push(
        headerFormat === "TEXT"
          ? { type: "HEADER", format: "TEXT", text: headerText }
          : { type: "HEADER", format: headerFormat }
      );
    }
    comps.push({ type: "BODY", text: body });
    if (footer.trim()) comps.push({ type: "FOOTER", text: footer });
    if (buttons.length > 0) {
      comps.push({ type: "BUTTONS", buttons: buttons.map((b) => ({ type: b.type, text: b.text, url: b.url })) });
    }
    return comps;
  }, [headerEnabled, headerFormat, headerText, body, footer, buttons]);

  async function handleSubmit() {
    setError("");

    if (!name.trim()) { setError("El nombre es requerido"); return; }
    if (!body.trim()) { setError("El cuerpo es requerido"); return; }
    if (headerEnabled && headerFormat !== "TEXT" && !headerExampleHandle) {
      setError(`Sube un archivo de ${headerFormat.toLowerCase()} de ejemplo para la cabecera`);
      return;
    }

    const components: {
      header?: { format: string; text?: string; exampleHandle?: string };
      body: string;
      footer?: string;
      buttons?: ButtonDef[];
    } = {
      body: body.trim(),
    };

    if (footer.trim()) components.footer = footer.trim();

    if (headerEnabled) {
      components.header = {
        format: headerFormat,
        text: headerFormat === "TEXT" ? headerText : undefined,
        exampleHandle: headerFormat !== "TEXT" ? headerExampleHandle : undefined,
      };
    }

    if (buttons.length > 0) components.buttons = buttons;

    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/templates/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waAccountId,
          name: name.trim(),
          language,
          components,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Error al crear plantilla");

      success(`Plantilla "${data.name}" creada y enviada a revisión`);
      resetForm();
      onClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear plantilla");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { resetForm(); onClose(); }}
      title="Nueva plantilla de marketing"
      description="Crea una plantilla que será enviada a revisión por Meta."
      size="xl"
      className="max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => { resetForm(); onClose(); }}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim() || !body.trim()}>
            {saving ? <Spinner /> : "Crear y enviar a revisión"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6">
        {/* FORM */}
        <div className="flex-1 space-y-5 min-w-0">
          {error && <Banner tone="danger">{error}</Banner>}

          <FormField label="Cuenta" required>
            {(id) => (
              <Select id={id} value={waAccountId} onChange={(e) => setWaAccountId(e.target.value)} placeholder="Seleccionar cuenta">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nombre" required hint="Ej: promo_junio_2026">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                  placeholder="promo_junio"
                />
              )}
            </FormField>
            <FormField label="Idioma" required>
              {(id) => (
                <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          {/* HEADER */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Cabecera (opcional)</span>
              <Switch checked={headerEnabled} onCheckedChange={setHeaderEnabled} />
            </div>
            {headerEnabled && (
              <>
                <RadioGroup
                  name="headerFormat"
                  options={HEADER_TYPES}
                  value={headerFormat}
                  onChange={(v) => handleHeaderFormatChange(v as typeof headerFormat)}
                />
                {headerFormat === "TEXT" ? (
                  <Input
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Texto de la cabecera"
                  />
                ) : (
                  <div className="space-y-2">
                    <input
                      ref={headerFileInputRef}
                      type="file"
                      accept={headerFormat === "IMAGE" ? "image/*" : headerFormat === "VIDEO" ? "video/*" : "application/pdf"}
                      onChange={handleHeaderFile}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Upload}
                      onClick={() => headerFileInputRef.current?.click()}
                      disabled={!waAccountId || headerUploading}
                    >
                      {headerUploading ? "Subiendo..." : "Subir archivo de ejemplo"}
                    </Button>
                    {headerFileName && !headerUploading && (
                      <p className="text-xs text-muted-darker">{headerFileName} — cargado</p>
                    )}
                    {!waAccountId && (
                      <p className="text-xs text-muted-darker">Selecciona primero una cuenta</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* BODY */}
          <FormField label="Cuerpo" required hint="Usa {{1}}, {{2}} para variables personalizadas">
            {(id) => (
              <div className="space-y-2">
                <Textarea
                  ref={bodyRef}
                  id={id}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Hola {{1}}, tu pedido {{2}} está listo."
                  rows={4}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={insertVariable}
                  >
                    <Type size={12} /> + Variable
                  </Button>
                </div>
              </div>
            )}
          </FormField>

          {/* FOOTER */}
          <FormField label="Pie de página (opcional)" hint="Máximo 60 caracteres">
            {(id) => (
              <Input
                id={id}
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Gracias por confiar en nosotros"
                maxLength={60}
              />
            )}
          </FormField>

          {/* BUTTONS */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Botones ({buttons.length}/10)</span>
            </div>

            {buttons.length > 0 && (
              <div className="space-y-2">
                {buttons.map((btn, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <Select
                      value={btn.type}
                      onChange={(e) => updateButton(idx, "type", e.target.value)}
                      className="w-28 shrink-0"
                    >
                      <option value="QUICK_REPLY">Respuesta</option>
                      <option value="URL">URL</option>
                    </Select>
                    <Input
                      value={btn.text}
                      onChange={(e) => updateButton(idx, "text", e.target.value)}
                      placeholder="Texto del botón"
                      maxLength={25}
                      className="flex-1"
                    />
                    {btn.type === "URL" && (
                      <Input
                        value={btn.url ?? ""}
                        onChange={(e) => updateButton(idx, "url", e.target.value)}
                        placeholder="https://..."
                        className="flex-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon={X}
                      onClick={() => removeButton(idx)}
                    />
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={addButton}
              disabled={buttons.length >= 10}
            >
              Agregar botón
            </Button>
          </div>
        </div>

        {/* PREVIEW */}
        <div className="lg:w-72 shrink-0">
          <p className="text-xs font-semibold text-muted-darker uppercase tracking-wider mb-3">Vista previa</p>
          <TemplatePreview components={previewComponents} headerImagePreview={headerPreviewUrl} />
          <p className="text-[10px] text-muted-darker mt-2 text-center">
            La revisión de Meta puede tomar hasta 24 horas. Aparecerá como &quot;Pendiente&quot; hasta que sea aprobada.
          </p>
        </div>
      </div>
    </Modal>
  );
}
