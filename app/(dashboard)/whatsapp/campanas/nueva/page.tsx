"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, X, Plus, Upload, FileX } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { SearchableSelect } from "@/app/components/ui/searchable-select";
import { Badge } from "@/app/components/ui/badge";
import { FormField } from "@/app/components/ui/form-field";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Spinner } from "@/app/components/ui/spinner";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";
import { parseCsv, type ParsedCsvRow } from "@/lib/whatsapp/parse-csv";
import { TemplatePreview } from "@/app/components/whatsapp/template-preview";

interface Account { id: string; name: string; channel: string; }
interface Template { id: string; name: string; language: string; category: string; status: string; components: unknown; }
interface RecipientRow { phoneNumber: string; contactName: string; params: string[] }

const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Deshabilitada",
};

const CSV_PAGE_SIZE = 10;

export default function NewCampaignPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headerFileInputRef = useRef<HTMLInputElement>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [name, setName] = useState("");
  const [waAccountId, setWaAccountId] = useState("");
  const [waTemplateId, setWaTemplateId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [headerParam, setHeaderParam] = useState("");
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState<string | null>(null);
  const [headerUploading, setHeaderUploading] = useState(false);
  const [buttonParam, setButtonParam] = useState("");

  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { phoneNumber: "", contactName: "", params: [] },
  ]);

  const [csvRows, setCsvRows] = useState<ParsedCsvRow[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvPage, setCsvPage] = useState(0);

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
    fetch("/api/whatsapp/accounts").then(r => r.json()).then(d => {
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
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setTemplates(d); })
      .catch(() => toastError("Error al cargar plantillas"))
      .finally(() => setLoadingTemplates(false));
  }, [waAccountId, toastError]);

  // Params, header/button values and any imported CSV are all specific to the
  // previously selected template's shape — switching templates invalidates them.
  function handleTemplateChange(id: string) {
    setWaTemplateId(id);
    setHeaderParam("");
    if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
    setHeaderPreviewUrl(null);
    setHeaderFileName(null);
    setButtonParam("");
    setCsvRows([]);
    setCsvFileName(null);
    setCsvPage(0);
    setRecipients(prev => prev.map(r => ({ ...r, params: [] })));
  }

  async function handleHeaderFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !waAccountId) return;

    if (templateVars?.header.format === "IMAGE") {
      if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
      setHeaderPreviewUrl(URL.createObjectURL(file));
    }
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
      if (headerPreviewUrl) URL.revokeObjectURL(headerPreviewUrl);
      setHeaderPreviewUrl(null);
    } finally {
      setHeaderUploading(false);
    }
  }

  function addRecipient() {
    setRecipients(prev => [...prev, { phoneNumber: "", contactName: "", params: [] }]);
  }
  function removeRecipient(idx: number) {
    setRecipients(prev => prev.filter((_, i) => i !== idx));
  }
  function updateRecipient(idx: number, field: "phoneNumber" | "contactName", value: string) {
    setRecipients(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function updateRecipientParam(idx: number, paramIdx: number, value: string) {
    setRecipients(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const params = [...r.params];
      params[paramIdx] = value;
      return { ...r, params };
    }));
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      setCsvRows(parsed.rows);
      setCsvFileName(file.name);
      setCsvPage(0);

      if (parsed.rows.length === 0) {
        toastError("No se encontraron destinatarios válidos en el archivo");
      } else if (bodyParamCount > 0 && parsed.paramColumnCount !== bodyParamCount) {
        toastError(`El archivo trae ${parsed.paramColumnCount} columna(s) de variables, pero la plantilla requiere ${bodyParamCount}`);
      } else {
        success(`${parsed.rows.length} destinatarios importados`);
      }
    };
    reader.onerror = () => toastError("Error al leer el archivo");
    reader.readAsText(file);
  }

  function clearCsv() {
    setCsvRows([]);
    setCsvFileName(null);
    setCsvPage(0);
  }

  const csvTotalPages = Math.max(1, Math.ceil(csvRows.length / CSV_PAGE_SIZE));
  const csvPageRows = useMemo(
    () => csvRows.slice(csvPage * CSV_PAGE_SIZE, csvPage * CSV_PAGE_SIZE + CSV_PAGE_SIZE),
    [csvRows, csvPage]
  );

  const csvColumns: TableColumn<ParsedCsvRow>[] = useMemo(() => [
    {
      key: "phoneNumber",
      header: "Teléfono",
      render: (r) => <span className="font-mono text-xs">{r.phoneNumber}</span>,
    },
    {
      key: "contactName",
      header: "Nombre",
      render: (r) => r.contactName || "—",
    },
    {
      key: "params",
      header: "Parámetros",
      render: (r) => r.params.length > 0 ? r.params.filter(Boolean).join(" · ") || "—" : "—",
    },
    {
      key: "status",
      header: "Estado",
      render: (r) => {
        const validPhone = /^\d{8,15}$/.test(r.phoneNumber);
        const validParams = bodyParamCount === 0 || r.params.filter(Boolean).length === bodyParamCount;
        const ok = validPhone && validParams;
        return <Badge tone={ok ? "success" : "danger"} size="sm">{ok ? "OK" : "Revisar"}</Badge>;
      },
    },
  ], [bodyParamCount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Requerido";
    if (!waAccountId) newErrors.waAccountId = "Selecciona una cuenta";
    if (!waTemplateId) newErrors.waTemplateId = "Selecciona una plantilla";

    if (templateVars?.header.required && !headerParam.trim()) {
      newErrors.headerParam = templateVars.header.format === "TEXT"
        ? "La cabecera de esta plantilla requiere un valor"
        : `Sube el archivo de ${templateVars.header.format?.toLowerCase()} para la cabecera`;
    }
    if (templateVars?.buttonUrl && !buttonParam.trim()) {
      newErrors.buttonParam = "El botón de esta plantilla requiere un valor";
    }

    if (!sendNow) {
      if (!scheduledAt) {
        newErrors.scheduledAt = "Selecciona la fecha y hora de envío";
      } else if (new Date(scheduledAt).getTime() < Date.now() - 60_000) {
        newErrors.scheduledAt = "La fecha ya pasó — elige una fecha futura";
      }
    }

    const manualRecipients = recipients.filter(r => r.phoneNumber.trim());
    // Duplicados (manual + CSV) se colapsan a la primera aparición — sin esto
    // el mismo lead recibía la plantilla dos veces.
    const seenPhones = new Set<string>();
    const allRecipients = [...manualRecipients, ...csvRows].filter(r => {
      const phone = r.phoneNumber.trim();
      if (seenPhones.has(phone)) return false;
      seenPhones.add(phone);
      return true;
    });
    const duplicateCount = manualRecipients.length + csvRows.length - allRecipients.length;

    if (allRecipients.length === 0) {
      newErrors.recipients = "Al menos un destinatario es requerido";
    } else {
      // El backend rechaza TODA la campaña si un solo teléfono no es numérico —
      // mejor señalarlo aquí que fallar con un mensaje genérico.
      const invalidPhones = allRecipients.filter(r => !/^\d{8,15}$/.test(r.phoneNumber.trim())).length;
      if (invalidPhones > 0) {
        newErrors.recipients = `Hay ${invalidPhones} teléfono(s) inválido(s) — usa solo dígitos (8 a 15), con código de país y sin espacios ni "+"`;
      } else if (bodyParamCount > 0) {
        const incomplete = allRecipients.some(r => r.params.filter(Boolean).length !== bodyParamCount);
        if (incomplete) {
          newErrors.recipients = `Todos los destinatarios deben tener los ${bodyParamCount} parámetro(s) del cuerpo`;
        }
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          waAccountId,
          waTemplateId,
          scheduledAt: sendNow ? null : scheduledAt || null,
          headerParam: headerParam.trim() || undefined,
          buttonParam: buttonParam.trim() || undefined,
          recipients: allRecipients.map(r => ({
            phoneNumber: r.phoneNumber.trim(),
            contactName: r.contactName.trim() || undefined,
            parameters: bodyParamCount > 0
              ? Object.fromEntries(r.params.map((v, i) => [String(i + 1), v]))
              : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");

      if (sendNow) {
        const sendRes = await fetch(`/api/whatsapp/campaigns/${data.id}/send`, { method: "POST" });
        if (!sendRes.ok) {
          // La campaña ya existe — no relanzar el submit (duplicaría la
          // campaña); avisar y mandar al usuario a la lista para reintentar.
          const sendData = await sendRes.json().catch(() => ({}));
          toastError(sendData.error ?? "La campaña se creó pero no pudo iniciarse — usa \"Enviar\" desde la lista");
          router.push("/whatsapp/campanas");
          return;
        }
      }

      const dupNote = duplicateCount > 0 ? ` (${duplicateCount} duplicado(s) omitido(s))` : "";
      success((sendNow ? "Campaña iniciada" : "Campaña programada") + dupNote);
      router.push("/whatsapp/campanas");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  const totalRecipients = recipients.filter(r => r.phoneNumber.trim()).length + csvRows.length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link href="/whatsapp/campanas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a campañas
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Nueva campaña</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <Card>
          <form onSubmit={handleSubmit}>
            <CardBody>
              <div className="space-y-5">
                <FormField label="Nombre de la campaña" required error={errors.name}>
                  {(id) => <Input id={id} value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Promoción Julio 2026" error={errors.name} />}
                </FormField>

                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Cuenta WhatsApp" required error={errors.waAccountId}>
                    {(id) => (
                      <Select id={id} value={waAccountId} onChange={e => { setWaAccountId(e.target.value); handleTemplateChange(""); }} placeholder="Seleccionar" error={errors.waAccountId}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    )}
                  </FormField>
                  <FormField
                    label="Plantilla"
                    required
                    error={errors.waTemplateId}
                    hint="Solo las plantillas aprobadas por Meta pueden usarse en una campaña."
                  >
                    {(id) => (
                      <SearchableSelect
                        id={id}
                        value={waTemplateId}
                        onChange={handleTemplateChange}
                        placeholder={loadingTemplates ? "Cargando..." : "Seleccionar"}
                        searchPlaceholder="Buscar plantilla..."
                        error={errors.waTemplateId}
                        disabled={!waAccountId || loadingTemplates}
                        options={templates.map(t => ({
                          value: t.id,
                          label: `${t.name} (${t.language}) — ${TEMPLATE_STATUS_LABEL[t.status] ?? t.status}`,
                          disabled: t.status !== "APPROVED",
                        }))}
                      />
                    )}
                  </FormField>
                </div>

                {templateVars?.header.required && templateVars.header.format === "TEXT" && (
                  <FormField
                    label="Valor de la cabecera"
                    required
                    error={errors.headerParam}
                    hint="Se aplica a todos los destinatarios de esta campaña."
                  >
                    {(id) => (
                      <Input
                        id={id}
                        value={headerParam}
                        onChange={e => setHeaderParam(e.target.value)}
                        placeholder="Texto de la cabecera"
                        error={errors.headerParam}
                      />
                    )}
                  </FormField>
                )}

                {templateVars?.header.required && templateVars.header.format !== "TEXT" && (
                  <FormField
                    label={`Archivo de ${templateVars.header.format?.toLowerCase()} para la cabecera`}
                    required
                    error={errors.headerParam}
                    hint="Se sube directo al sistema y se aplica a todos los destinatarios de esta campaña."
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
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          icon={Upload}
                          onClick={() => headerFileInputRef.current?.click()}
                          disabled={!waAccountId || headerUploading}
                        >
                          {headerUploading ? "Subiendo..." : "Subir archivo"}
                        </Button>
                        {headerFileName && !headerUploading && (
                          <p className="text-xs text-muted-darker">{headerFileName} — cargado</p>
                        )}
                        {!waAccountId && (
                          <p className="text-xs text-muted-darker">Selecciona primero una cuenta de WhatsApp</p>
                        )}
                      </div>
                    )}
                  </FormField>
                )}

                {templateVars?.buttonUrl && (
                  <FormField
                    label={`Valor dinámico del botón "${templateVars.buttonUrl.text}"`}
                    required
                    error={errors.buttonParam}
                    hint="Se aplica a todos los destinatarios de esta campaña."
                  >
                    {(id) => (
                      <Input
                        id={id}
                        value={buttonParam}
                        onChange={e => setButtonParam(e.target.value)}
                        placeholder="Sufijo o valor de la URL"
                        error={errors.buttonParam}
                      />
                    )}
                  </FormField>
                )}

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Enviar ahora</p>
                    <p className="text-xs text-muted-darker">La campaña comenzará a enviarse inmediatamente</p>
                  </div>
                  <input type="checkbox" checked={sendNow} onChange={e => setSendNow(e.target.checked)} className="h-5 w-5 rounded border-border text-accent focus:ring-accent" />
                </div>

                {!sendNow && (
                  <FormField label="Programar para" required hint="Fecha y hora de inicio" error={errors.scheduledAt}>
                    {(id) => <DatePicker id={id} value={scheduledAt} onChange={setScheduledAt} placeholder="Seleccionar fecha" />}
                  </FormField>
                )}

                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-semibold mb-3">Destinatarios ({totalRecipients})</h3>

                  <div className="space-y-2 mb-4">
                    {recipients.map((r, i) => (
                      <div key={i} className="flex flex-wrap gap-2 items-start">
                        <Input
                          value={r.phoneNumber}
                          onChange={e => updateRecipient(i, "phoneNumber", e.target.value)}
                          placeholder="5215551234567"
                          className="flex-1 min-w-[140px]"
                        />
                        <Input
                          value={r.contactName}
                          onChange={e => updateRecipient(i, "contactName", e.target.value)}
                          placeholder="Nombre (opcional)"
                          className="w-36"
                        />
                        {Array.from({ length: bodyParamCount }).map((_, paramIdx) => (
                          <Input
                            key={paramIdx}
                            value={r.params[paramIdx] ?? ""}
                            onChange={e => updateRecipientParam(i, paramIdx, e.target.value)}
                            placeholder={`{{${paramIdx + 1}}}`}
                            className="w-28"
                          />
                        ))}
                        {recipients.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" icon={X} onClick={() => removeRecipient(i)} />
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={addRecipient}>
                      Agregar número
                    </Button>
                  </div>

                  <div className="border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Importar desde CSV</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvFile}
                        className="hidden"
                      />
                      <Button type="button" variant="secondary" size="sm" icon={Upload} onClick={() => fileInputRef.current?.click()}>
                        Subir archivo
                      </Button>
                    </div>
                    <p className="text-xs text-muted-darker">
                      Primera fila con encabezados: <code className="bg-surface px-1 rounded">telefono</code>, <code className="bg-surface px-1 rounded">nombre</code>{bodyParamCount > 0 ? `, y ${bodyParamCount} columna(s) más para las variables del cuerpo` : ""}.
                    </p>

                    {csvFileName && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-darker">
                            {csvFileName} — {csvRows.length} destinatario(s)
                          </span>
                          <Button type="button" variant="ghost" size="sm" icon={FileX} onClick={clearCsv}>
                            Quitar
                          </Button>
                        </div>

                        <Table
                          columns={csvColumns}
                          rows={csvPageRows}
                          rowKey={(r) => r.id}
                          emptyIcon={Upload}
                          emptyTitle="Sin destinatarios"
                          mobileCard={(r) => {
                            const params = csvColumns.find((c) => c.key === "params")!;
                            const status = csvColumns.find((c) => c.key === "status")!;
                            return (
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-sm font-medium truncate">{r.phoneNumber}</span>
                                  {status.render(r)}
                                </div>
                                {r.contactName && <div className="text-xs text-muted-darker truncate">{r.contactName}</div>}
                                <div className="text-xs text-muted-darker truncate">{params.render(r)}</div>
                              </div>
                            );
                          }}
                        />

                        {csvTotalPages > 1 && (
                          <div className="flex items-center justify-between text-xs pt-1">
                            <span className="text-muted-darker">Página {csvPage + 1} de {csvTotalPages}</span>
                            <div className="flex gap-2">
                              <Button type="button" variant="secondary" size="sm" disabled={csvPage === 0} onClick={() => setCsvPage(p => p - 1)}>
                                Anterior
                              </Button>
                              <Button type="button" variant="secondary" size="sm" disabled={csvPage >= csvTotalPages - 1} onClick={() => setCsvPage(p => p + 1)}>
                                Siguiente
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {errors.recipients && <p className="text-xs text-danger mt-2">{errors.recipients}</p>}
                </div>
              </div>
            </CardBody>
            <CardFooter>
              <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
                {saving ? <Spinner /> : sendNow ? "Crear y enviar" : "Programar campaña"}
              </Button>
              <Button href="/whatsapp/campanas" type="button" variant="secondary">Cancelar</Button>
            </CardFooter>
          </form>
        </Card>

        <div className="lg:sticky lg:top-6">
          {selectedTemplate ? (
            <TemplatePreview components={selectedTemplate.components} headerImagePreview={headerPreviewUrl} />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-darker">
              Selecciona una plantilla para ver la vista previa
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
