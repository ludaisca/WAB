"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload, RefreshCw } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select } from "@/app/components/ui/select";
import { SearchableSelect } from "@/app/components/ui/searchable-select";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";
import type { SheetTab } from "@/lib/google/sheets-read";

interface Account { id: string; name: string; channel: string; }
interface Template { id: string; name: string; language: string; category: string; status: string; components: unknown; }

const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Deshabilitada",
};

export default function NewLeadSheetSourcePage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const headerFileInputRef = useRef<HTMLInputElement>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [name, setName] = useState("");
  const [waAccountId, setWaAccountId] = useState("");
  const [waTemplateId, setWaTemplateId] = useState("");
  const [headerParam, setHeaderParam] = useState("");
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [headerUploading, setHeaderUploading] = useState(false);
  const [buttonParam, setButtonParam] = useState("");

  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [loadingTab, setLoadingTab] = useState(false);
  const [header, setHeader] = useState<string[]>([]);
  const [sampleRow, setSampleRow] = useState<string[] | null>(null);
  const [rowCount, setRowCount] = useState(0);

  const [phoneColumn, setPhoneColumn] = useState("");
  const [nameColumn, setNameColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [bodyColumns, setBodyColumns] = useState<string[]>([]);
  // Variable del body que rota entre ejecutivos (null = ninguna) y su lista de
  // valores, escrita uno por línea.
  const [rotatingParamIndex, setRotatingParamIndex] = useState<number | null>(null);
  const [rotatingValuesText, setRotatingValuesText] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === waTemplateId) ?? null,
    [templates, waTemplateId]
  );
  const templateVars = useMemo(
    () => (selectedTemplate ? getTemplateVariables(selectedTemplate.components) : null),
    [selectedTemplate]
  );
  const bodyParamCount = templateVars?.bodyParamCount ?? 0;

  useEffect(() => {
    fetch("/api/whatsapp/accounts").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setAccounts(d.filter((a: Account) => a.channel === "META_CLOUD"));
    }).catch(() => toastError("Error al cargar cuentas"));
  }, [toastError]);

  useEffect(() => {
    if (!waAccountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load templates when account selection changes
    setLoadingTemplates(true);
    fetch(`/api/whatsapp/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waAccountId }),
    })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTemplates(d); })
      .catch(() => toastError("Error al cargar plantillas"))
      .finally(() => setLoadingTemplates(false));
  }, [waAccountId, toastError]);

  function handleTemplateChange(id: string) {
    setWaTemplateId(id);
    setHeaderParam("");
    setHeaderFileName(null);
    setButtonParam("");
    setBodyColumns([]);
    setRotatingParamIndex(null);
    setRotatingValuesText("");
  }

  async function handleHeaderFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !waAccountId) return;

    setHeaderFileName(file.name);
    setHeaderUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("accountId", waAccountId);
      const res = await fetch("/api/whatsapp/media", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al subir el archivo");
      setHeaderParam(data.mediaId);
      success("Archivo de cabecera cargado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al subir el archivo");
      setHeaderParam("");
      setHeaderFileName(null);
    } finally {
      setHeaderUploading(false);
    }
  }

  async function loadSheet() {
    if (!sheetUrl.trim()) return;
    setLoadingSheet(true);
    setTabs([]);
    setSheetName("");
    setHeader([]);
    setSampleRow(null);
    try {
      const res = await fetch("/api/whatsapp/lead-sheet-sources/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetIdOrUrl: sheetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al leer la hoja");
      setSpreadsheetId(data.spreadsheetId);
      setTabs(data.tabs);
      if (data.tabs.length === 1) {
        await loadTab(data.spreadsheetId, data.tabs[0].title);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al leer la hoja");
    } finally {
      setLoadingSheet(false);
    }
  }

  async function loadTab(sheetId: string, tab: string) {
    setSheetName(tab);
    setLoadingTab(true);
    setHeader([]);
    setSampleRow(null);
    setPhoneColumn("");
    setNameColumn("");
    setBodyColumns([]);
    try {
      const res = await fetch("/api/whatsapp/lead-sheet-sources/preview-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId: sheetId, sheetName: tab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al leer la pestaña");
      setHeader(data.header);
      setSampleRow(data.sampleRow);
      setRowCount(data.rowCount);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al leer la pestaña");
    } finally {
      setLoadingTab(false);
    }
  }

  // Valor centinela del <Select> de columnas para marcar "esta variable rota".
  const ROTATE = "__ROTATE__";

  const rotatingValues = useMemo(
    () => rotatingValuesText.split("\n").map((v) => v.trim()).filter(Boolean),
    [rotatingValuesText]
  );

  function updateBodyColumn(idx: number, value: string) {
    if (value === ROTATE) {
      // Solo una variable puede rotar: al marcar una, la anterior se libera.
      setRotatingParamIndex(idx);
      setBodyColumns((prev) => {
        const next = [...prev];
        next[idx] = "";
        return next;
      });
      return;
    }
    if (rotatingParamIndex === idx) setRotatingParamIndex(null);
    setBodyColumns((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Requerido";
    if (!waAccountId) newErrors.waAccountId = "Selecciona una cuenta";
    if (!waTemplateId) newErrors.waTemplateId = "Selecciona una plantilla";
    if (!spreadsheetId || !sheetName) newErrors.sheet = "Carga una hoja y selecciona una pestaña";
    if (!phoneColumn) newErrors.phoneColumn = "Selecciona la columna de teléfono";
    // La variable rotativa no consume columna, por eso se descuenta del total.
    const columnsNeeded = bodyParamCount - (rotatingParamIndex !== null ? 1 : 0);
    if (bodyParamCount > 0 && bodyColumns.filter(Boolean).length !== columnsNeeded) {
      newErrors.bodyColumns = `Selecciona las ${columnsNeeded} columna(s) que alimentan las variables del cuerpo`;
    }
    if (rotatingParamIndex !== null && rotatingValues.length < 2) {
      newErrors.rotatingValues = "Escribe al menos 2 valores para que haya rotación";
    }
    if (templateVars?.header.required && !headerParam.trim()) {
      newErrors.headerParam = templateVars.header.format === "TEXT"
        ? "La cabecera de esta plantilla requiere un valor"
        : `Sube el archivo de ${templateVars.header.format?.toLowerCase()} para la cabecera`;
    }
    if (templateVars?.buttonUrl && !buttonParam.trim()) {
      newErrors.buttonParam = "El botón de esta plantilla requiere un valor";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/lead-sheet-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          waAccountId,
          waTemplateId,
          spreadsheetId,
          sheetName,
          phoneColumn,
          nameColumn: nameColumn || undefined,
          dateColumn: dateColumn || undefined,
          // Se envía denso (una entrada por variable, "" en la rotativa) porque el
          // API valida que la longitud coincida con la de la plantilla.
          bodyColumns: Array.from({ length: bodyParamCount }, (_, i) => bodyColumns[i] ?? ""),
          headerParam: headerParam.trim() || undefined,
          buttonParam: buttonParam.trim() || undefined,
          rotatingParamIndex,
          rotatingValues,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");

      success("Fuente conectada — las filas ya existentes no dispararán envío, solo las nuevas");
      router.push(`/whatsapp/campanas/automatizacion/${data.id}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link href="/whatsapp/campanas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a campañas
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Nueva fuente de leads</h1>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardBody>
            <div className="space-y-5">
              <FormField label="Nombre de la fuente" required error={errors.name} hint='Ej: "Formulario Implantes Dentales — Facebook"'>
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Campaña FB — Implantes" error={errors.name} />}
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Cuenta WhatsApp" required error={errors.waAccountId}>
                  {(id) => (
                    <Select id={id} value={waAccountId} onChange={(e) => { setWaAccountId(e.target.value); handleTemplateChange(""); }} placeholder="Seleccionar" error={errors.waAccountId}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  )}
                </FormField>
                <FormField label="Plantilla" required error={errors.waTemplateId} hint="Solo plantillas aprobadas por Meta.">
                  {(id) => (
                    <SearchableSelect
                      id={id}
                      value={waTemplateId}
                      onChange={handleTemplateChange}
                      placeholder={loadingTemplates ? "Cargando..." : "Seleccionar"}
                      searchPlaceholder="Buscar plantilla..."
                      error={errors.waTemplateId}
                      disabled={!waAccountId || loadingTemplates}
                      options={templates.map((t) => ({
                        value: t.id,
                        label: `${t.name} (${t.language}) — ${TEMPLATE_STATUS_LABEL[t.status] ?? t.status}`,
                        disabled: t.status !== "APPROVED",
                      }))}
                    />
                  )}
                </FormField>
              </div>

              {templateVars?.header.required && templateVars.header.format === "TEXT" && (
                <FormField label="Valor de la cabecera" required error={errors.headerParam} hint="Se aplica igual a todos los leads.">
                  {(id) => <Input id={id} value={headerParam} onChange={(e) => setHeaderParam(e.target.value)} placeholder="Texto de la cabecera" error={errors.headerParam} />}
                </FormField>
              )}

              {templateVars?.header.required && templateVars.header.format !== "TEXT" && (
                <FormField
                  label={`Archivo de ${templateVars.header.format?.toLowerCase()} para la cabecera`}
                  required
                  error={errors.headerParam}
                  hint="Se aplica igual a todos los leads que dispare esta fuente."
                >
                  {() => (
                    <div className="space-y-2">
                      <input
                        ref={headerFileInputRef}
                        type="file"
                        accept={
                          templateVars.header.format === "IMAGE" ? "image/*"
                            : templateVars.header.format === "VIDEO" ? "video/*"
                            : "application/pdf"
                        }
                        onChange={handleHeaderFile}
                        className="hidden"
                      />
                      <Button type="button" variant="secondary" size="sm" icon={Upload} onClick={() => headerFileInputRef.current?.click()} disabled={!waAccountId || headerUploading}>
                        {headerUploading ? "Subiendo..." : "Subir archivo"}
                      </Button>
                      {headerFileName && !headerUploading && <p className="text-xs text-muted-darker">{headerFileName} — cargado</p>}
                      {!waAccountId && <p className="text-xs text-muted-darker">Selecciona primero una cuenta de WhatsApp</p>}
                    </div>
                  )}
                </FormField>
              )}

              {templateVars?.buttonUrl && (
                <FormField label={`Valor dinámico del botón "${templateVars.buttonUrl.text}"`} required error={errors.buttonParam} hint="Se aplica igual a todos los leads.">
                  {(id) => <Input id={id} value={buttonParam} onChange={(e) => setButtonParam(e.target.value)} placeholder="Sufijo o valor de la URL" error={errors.buttonParam} />}
                </FormField>
              )}

              <div className="border-t border-border pt-4 space-y-4">
                <h3 className="text-sm font-semibold">Hoja de Google Sheets</h3>
                <FormField label="URL o ID de la hoja" required error={errors.sheet} hint="Pega el enlace completo de Google Sheets, o solo el ID.">
                  {(id) => (
                    <div className="flex gap-2">
                      <Input id={id} value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="flex-1" />
                      <Button type="button" variant="secondary" icon={loadingSheet ? undefined : RefreshCw} onClick={loadSheet} disabled={loadingSheet || !sheetUrl.trim()}>
                        {loadingSheet ? <Spinner /> : "Cargar hoja"}
                      </Button>
                    </div>
                  )}
                </FormField>

                {tabs.length > 0 && (
                  <FormField label="Pestaña">
                    {(id) => (
                      <Select id={id} value={sheetName} onChange={(e) => loadTab(spreadsheetId, e.target.value)} placeholder="Seleccionar pestaña">
                        {tabs.map((t) => <option key={t.title} value={t.title}>{t.title}</option>)}
                      </Select>
                    )}
                  </FormField>
                )}

                {loadingTab && <p className="text-xs text-muted-darker">Cargando columnas...</p>}

                {header.length > 0 && !loadingTab && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-darker">
                      {rowCount} fila(s) de datos encontradas — las que ya existen no dispararán envío, solo las que aparezcan después de conectar.
                    </p>

                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-surface">
                            {header.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h || `(col ${i + 1})`}</th>)}
                          </tr>
                        </thead>
                        {sampleRow && (
                          <tbody>
                            <tr>
                              {header.map((_, i) => <td key={i} className="px-2 py-1.5 text-muted-darker whitespace-nowrap">{sampleRow[i] ?? ""}</td>)}
                            </tr>
                          </tbody>
                        )}
                      </table>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Columna de teléfono" required error={errors.phoneColumn}>
                        {(id) => (
                          <Select id={id} value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)} placeholder="Seleccionar" error={errors.phoneColumn}>
                            {header.map((h, i) => <option key={i} value={h}>{h || `(col ${i + 1})`}</option>)}
                          </Select>
                        )}
                      </FormField>
                      <FormField label="Columna de nombre" hint="Opcional">
                        {(id) => (
                          <Select id={id} value={nameColumn} onChange={(e) => setNameColumn(e.target.value)} placeholder="Ninguna">
                            {header.map((h, i) => <option key={i} value={h}>{h || `(col ${i + 1})`}</option>)}
                          </Select>
                        )}
                      </FormField>
                      <FormField
                        label="Columna de fecha de registro"
                        hint="Opcional. Cuándo dejó sus datos el lead — se muestra tal cual viene en la hoja, junto a la fecha de sincronización."
                      >
                        {(id) => (
                          <Select id={id} value={dateColumn} onChange={(e) => setDateColumn(e.target.value)} placeholder="Ninguna">
                            {header.map((h, i) => <option key={i} value={h}>{h || `(col ${i + 1})`}</option>)}
                          </Select>
                        )}
                      </FormField>
                    </div>

                    {bodyParamCount > 0 && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Variables del cuerpo de la plantilla</p>
                        {errors.bodyColumns && <p className="text-xs text-danger">{errors.bodyColumns}</p>}
                        <div className="grid gap-4 sm:grid-cols-2">
                          {Array.from({ length: bodyParamCount }).map((_, idx) => {
                            const varLabel = templateVars?.bodyParamNames
                              ? `Variable {{${templateVars.bodyParamNames[idx]}}}`
                              : `Variable {{${idx + 1}}}`;
                            return (
                              <FormField key={idx} label={varLabel} required>
                                {(id) => (
                                  <Select
                                    id={id}
                                    value={rotatingParamIndex === idx ? ROTATE : bodyColumns[idx] ?? ""}
                                    onChange={(e) => updateBodyColumn(idx, e.target.value)}
                                    placeholder="Seleccionar columna"
                                  >
                                    {header.map((h, i) => <option key={i} value={h}>{h || `(col ${i + 1})`}</option>)}
                                    <option value={ROTATE}>🔁 Rotar entre ejecutivos</option>
                                  </Select>
                                )}
                              </FormField>
                            );
                          })}
                        </div>

                        {rotatingParamIndex !== null && (
                          <FormField
                            label="Valores a rotar"
                            required
                            error={errors.rotatingValues}
                            hint="Uno por línea. Se asignan en orden y de uno en uno: el primer lead recibe el primero, el segundo lead el segundo, y al llegar al final vuelve a empezar."
                          >
                            {(id) => (
                              <Textarea
                                id={id}
                                value={rotatingValuesText}
                                onChange={(e) => {
                                  setRotatingValuesText(e.target.value);
                                  // El aviso "faltan valores" queda incoherente junto al
                                  // resumen de reparto si no se limpia al escribir.
                                  if (errors.rotatingValues) {
                                    setErrors((prev) => {
                                      const { rotatingValues: _, ...rest } = prev;
                                      return rest;
                                    });
                                  }
                                }}
                                placeholder={"Juan X\nCarlos X"}
                                rows={4}
                              />
                            )}
                          </FormField>
                        )}
                        {rotatingParamIndex !== null && rotatingValues.length >= 2 && (
                          <p className="text-xs text-muted-darker">
                            {rotatingValues.length} valores en rotación — cada uno recibirá aproximadamente
                            {" "}{Math.round(100 / rotatingValues.length)}% de los leads.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : "Conectar fuente"}
            </Button>
            <Button href="/whatsapp/campanas" type="button" variant="secondary">Cancelar</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
