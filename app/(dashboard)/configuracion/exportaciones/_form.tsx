"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { Checkbox } from "@/app/components/ui/checkbox";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";
import { DATASET_LABELS } from "@/lib/whatsapp/sheet-export-access";

type Dataset = "LEAD_SCORES" | "CAMPAIGN_RESULTS" | "CHATS" | "CONTACTS";

export interface SheetExportRow {
  id: string;
  name: string;
  dataset: Dataset;
  spreadsheetId: string;
  sheetName: string;
  columns: string[];
  filters: Record<string, unknown>;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface Option {
  value: string;
  label: string;
}

// La API /sheet-exports/columns devuelve {key,label} (mismo shape que
// ExportColumnDef en todo el resto del repo) — distinto de Option, que usan
// los MultiSelect de filtros ({value,label}). No unificar: mezclarlos fue
// justo el bug que produjo columns con key=undefined.
interface ColumnOption {
  key: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  editId: string | null;
  initialData: SheetExportRow | null;
  onSaved: () => void;
}

const CHAT_STATUS_OPTIONS: Option[] = [
  { value: "OPEN", label: "Abierto" },
  { value: "PENDING", label: "Pendiente" },
  { value: "RESOLVED", label: "Resuelto" },
];

const LEAD_STATUS_OPTIONS: Option[] = [
  { value: "NEW", label: "Nuevo" },
  { value: "CONTACTED", label: "Contactado" },
  { value: "QUALIFIED", label: "Calificado" },
  { value: "CUSTOMER", label: "Cliente" },
  { value: "LOST", label: "Perdido" },
];

const CAMPAIGN_STATUS_OPTIONS: Option[] = [
  { value: "PENDING", label: "Pendiente" },
  { value: "SENT", label: "Enviado" },
  { value: "DELIVERED", label: "Entregado" },
  { value: "READ", label: "Leído" },
  { value: "FAILED", label: "Fallido" },
  { value: "SKIPPED", label: "Omitido" },
];

const ORIGIN_OPTIONS: Option[] = [
  { value: "manual", label: "Campaña masiva" },
  { value: "automatizacion", label: "Automatización" },
];

const LEAD_LABEL_OPTIONS: Option[] = [
  { value: "prioridad_alta", label: "Prioridad alta" },
  { value: "oportunidad", label: "Oportunidad" },
  { value: "interesado", label: "Interesado" },
  { value: "frio", label: "Frío" },
  { value: "descartado", label: "Descartado" },
];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function SheetExportFormModal({ open, onClose, editId, initialData, onSaved }: Props) {
  const { success, error: toastError } = useToast();
  const isEdit = !!editId;

  const [name, setName] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [resolvedSpreadsheetId, setResolvedSpreadsheetId] = useState("");
  const [existingTabs, setExistingTabs] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [resolvingUrl, setResolvingUrl] = useState(false);

  const [dataset, setDataset] = useState<Dataset | "">("");
  const [availableDatasets, setAvailableDatasets] = useState<Option[]>([]);
  const [availableColumns, setAvailableColumns] = useState<ColumnOption[]>([]);
  const [columns, setColumns] = useState<Set<string>>(new Set());

  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [scorerIds, setScorerIds] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [campaignStatuses, setCampaignStatuses] = useState<string[]>([]);
  const [chatStatuses, setChatStatuses] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [accountOptions, setAccountOptions] = useState<Option[]>([]);
  const [scorerOptions, setScorerOptions] = useState<Option[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<Option[]>([]);
  const [tagOptions, setTagOptions] = useState<Option[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Modal se queda montado (ver el patrón `visible` de Modal) — re-sincroniza
  // en cada transición open:false→true, igual que plantillas/_form.tsx.
  useEffect(() => {
    if (!open) return;

    if (initialData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- re-sincroniza el formulario entero en la transición open, no en cada render
      setName(initialData.name);
      setUrlInput(initialData.spreadsheetId);
      setResolvedSpreadsheetId(initialData.spreadsheetId);
      setExistingTabs([]);
      setSheetName(initialData.sheetName);
      setDataset(initialData.dataset);
      setColumns(new Set(initialData.columns));

      const f = initialData.filters ?? {};
      setAccountIds(asStringArray(f.accountIds));
      setScorerIds(asStringArray(f.scorerIds));
      setLabels(asStringArray(f.labels));
      setCampaignIds(asStringArray(f.campaignIds));
      setOrigins(asStringArray(f.origins));
      setCampaignStatuses(initialData.dataset === "CAMPAIGN_RESULTS" ? asStringArray(f.statuses) : []);
      setChatStatuses(initialData.dataset === "CHATS" ? asStringArray(f.statuses) : []);
      setTagIds(asStringArray(f.tagIds));
      setLeadStatuses(asStringArray(f.leadStatuses));
      setDateFrom(typeof f.dateFrom === "string" ? f.dateFrom : "");
      setDateTo(typeof f.dateTo === "string" ? f.dateTo : "");
    } else {
      setName("");
      setUrlInput("");
      setResolvedSpreadsheetId("");
      setExistingTabs([]);
      setSheetName("");
      setDataset("");
      setColumns(new Set());
      setAccountIds([]);
      setScorerIds([]);
      setLabels([]);
      setCampaignIds([]);
      setOrigins([]);
      setCampaignStatuses([]);
      setChatStatuses([]);
      setTagIds([]);
      setLeadStatuses([]);
      setDateFrom("");
      setDateTo("");
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo re-sincroniza en la transición open, initialData ya viene resuelto por el padre
  }, [open]);

  // Opciones de filtro — se cargan una vez al abrir, se reusan sin importar el
  // dataset elegido (son las mismas 4 rutas que ya consumen otras pantallas).
  useEffect(() => {
    if (!open) return;
    fetch("/api/whatsapp/sheet-exports/datasets")
      .then((r) => r.json())
      .then((d) => setAvailableDatasets(Array.isArray(d.datasets) ? d.datasets : []))
      .catch(() => setAvailableDatasets([]));
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) =>
        setAccountOptions(
          Array.isArray(d)
            ? d.map((a: { id: string; name: string; origen?: string | null }) => ({
                value: a.id,
                label: a.origen ? `${a.name} — ${a.origen}` : a.name,
              }))
            : []
        )
      )
      .catch(() => setAccountOptions([]));
    fetch("/api/whatsapp/tags")
      .then((r) => r.json())
      .then((d) => setTagOptions(Array.isArray(d) ? d.map((t: { id: string; name: string }) => ({ value: t.id, label: t.name })) : []))
      .catch(() => setTagOptions([]));
    fetch("/api/whatsapp/lead-scorers")
      .then((r) => r.json())
      .then((d) => setScorerOptions(Array.isArray(d) ? d.map((s: { id: string; name: string }) => ({ value: s.id, label: s.name })) : []))
      .catch(() => setScorerOptions([]));
    Promise.all([
      fetch("/api/whatsapp/campaigns").then((r) => r.json()),
      fetch("/api/whatsapp/lead-sheet-sources").then((r) => r.json()),
    ])
      .then(([campaigns, sources]) => {
        const campaignOpts = Array.isArray(campaigns)
          ? campaigns.map((c: { id: string; name: string }) => ({ value: c.id, label: `Campaña: ${c.name}` }))
          : [];
        const sourceOpts = Array.isArray(sources)
          ? sources.map((s: { id: string; name: string }) => ({ value: s.id, label: `Automatización: ${s.name}` }))
          : [];
        setCampaignOptions([...campaignOpts, ...sourceOpts]);
      })
      .catch(() => setCampaignOptions([]));
  }, [open]);

  // Columnas disponibles cambian con el dataset elegido.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia las columnas visibles al cambiar/vaciar el dataset, antes del fetch
    if (!dataset) { setAvailableColumns([]); return; }
    fetch(`/api/whatsapp/sheet-exports/columns?dataset=${dataset}`)
      .then((r) => r.json())
      .then((d) => setAvailableColumns(Array.isArray(d.columns) ? d.columns : []))
      .catch(() => setAvailableColumns([]));
  }, [dataset]);

  const handleResolveUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    setResolvingUrl(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/sheet-exports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetIdOrUrl: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo leer la hoja");
      setResolvedSpreadsheetId(data.spreadsheetId);
      setExistingTabs((data.tabs ?? []).map((t: { title: string }) => t.title));
    } catch (err) {
      setResolvedSpreadsheetId("");
      setExistingTabs([]);
      toastError(err instanceof Error ? err.message : "No se pudo leer la hoja");
    } finally {
      setResolvingUrl(false);
    }
  }, [urlInput, toastError]);

  function toggleColumn(key: string) {
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function buildFilters(): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (accountIds.length) base.accountIds = accountIds;
    if (dateFrom) base.dateFrom = dateFrom;
    if (dateTo) base.dateTo = dateTo;

    if (dataset === "LEAD_SCORES") {
      if (scorerIds.length) base.scorerIds = scorerIds;
      if (labels.length) base.labels = labels;
    } else if (dataset === "CAMPAIGN_RESULTS") {
      if (campaignIds.length) base.campaignIds = campaignIds;
      if (origins.length) base.origins = origins;
      if (campaignStatuses.length) base.statuses = campaignStatuses;
    } else if (dataset === "CHATS") {
      if (chatStatuses.length) base.statuses = chatStatuses;
      if (tagIds.length) base.tagIds = tagIds;
    } else if (dataset === "CONTACTS") {
      if (tagIds.length) base.tagIds = tagIds;
      if (leadStatuses.length) base.leadStatuses = leadStatuses;
    }
    return base;
  }

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("El nombre es requerido"); return; }
    if (!resolvedSpreadsheetId) { setError("Pega el enlace de una hoja de Google y espera a que se resuelva"); return; }
    if (!sheetName.trim()) { setError("Indica el nombre de la pestaña"); return; }
    if (!isEdit && !dataset) { setError("Elige qué vas a exportar"); return; }
    if (columns.size === 0) { setError("Elige al menos una columna"); return; }

    setSaving(true);
    try {
      const filters = buildFilters();
      const payload = isEdit
        ? { name: name.trim(), spreadsheetId: resolvedSpreadsheetId, sheetName: sheetName.trim(), columns: Array.from(columns), filters }
        : { name: name.trim(), dataset, spreadsheetId: resolvedSpreadsheetId, sheetName: sheetName.trim(), columns: Array.from(columns), filters };

      const res = await fetch(isEdit ? `/api/whatsapp/sheet-exports/${editId}` : "/api/whatsapp/sheet-exports", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");

      success(isEdit ? "Exportación actualizada" : "Exportación creada");
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const allColumnsSelected = availableColumns.length > 0 && columns.size === availableColumns.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar exportación" : "Nueva exportación"}
      description="Elige qué dato exportar, con qué columnas y filtros, y a qué hoja de Google."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !resolvedSpreadsheetId || !sheetName.trim() || (!isEdit && !dataset) || columns.size === 0}
          >
            {saving ? <Spinner /> : isEdit ? "Guardar cambios" : "Crear exportación"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Banner tone="danger">{error}</Banner>}

        <FormField label="Nombre" required>
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Chats abiertos de la cuenta principal" />
          )}
        </FormField>

        <FormField label="Hoja de Google" required hint="Pega el enlace completo o solo el ID de la hoja">
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleResolveUrl} loading={resolvingUrl} disabled={!urlInput.trim()}>
                Buscar
              </Button>
            </div>
          )}
        </FormField>

        {resolvedSpreadsheetId && (
          <FormField label="Pestaña destino" required hint="Elige una pestaña existente o escribe un nombre nuevo para crearla">
            {(id) => (
              <div className="space-y-2">
                <Input id={id} value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Nombre de la pestaña" />
                {existingTabs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {existingTabs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSheetName(t)}
                        className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-darker hover:border-accent hover:text-accent transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </FormField>
        )}

        <FormField label="Qué exportar" required>
          {(id) =>
            isEdit ? (
              <Badge tone="accent">{DATASET_LABELS[dataset as Dataset] ?? dataset}</Badge>
            ) : (
              <Select
                id={id}
                value={dataset}
                onChange={(e) => { setDataset(e.target.value as Dataset); setColumns(new Set()); }}
                placeholder="Selecciona un dataset"
              >
                {availableDatasets.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Select>
            )
          }
        </FormField>

        {dataset && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Columnas</p>
              <button
                type="button"
                onClick={() => setColumns(allColumnsSelected ? new Set() : new Set(availableColumns.map((c) => c.key)))}
                className="text-xs text-accent hover:underline"
              >
                {allColumnsSelected ? "Ninguna" : "Todas"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {availableColumns.map((c) => (
                <Checkbox key={c.key} id={`col-${c.key}`} checked={columns.has(c.key)} onChange={() => toggleColumn(c.key)} label={c.label} />
              ))}
            </div>
          </div>
        )}

        {dataset && (
          <div className="border border-border rounded-xl p-4 space-y-4">
            <p className="text-sm font-medium">Filtros (opcional)</p>

            <FormField label="Cuentas">
              {(id) => <MultiSelect id={id} options={accountOptions} value={accountIds} onChange={setAccountIds} placeholder="Todas tus cuentas" />}
            </FormField>

            {dataset === "LEAD_SCORES" && (
              <>
                <FormField label="Calificadores">
                  {(id) => <MultiSelect id={id} options={scorerOptions} value={scorerIds} onChange={setScorerIds} placeholder="Todos los calificadores" />}
                </FormField>
                <FormField label="Calificación">
                  {(id) => <MultiSelect id={id} options={LEAD_LABEL_OPTIONS} value={labels} onChange={setLabels} placeholder="Todas las calificaciones" />}
                </FormField>
              </>
            )}

            {dataset === "CAMPAIGN_RESULTS" && (
              <>
                <FormField label="Campañas / automatizaciones">
                  {(id) => <MultiSelect id={id} options={campaignOptions} value={campaignIds} onChange={setCampaignIds} placeholder="Todas" />}
                </FormField>
                <FormField label="Origen">
                  {(id) => <MultiSelect id={id} options={ORIGIN_OPTIONS} value={origins} onChange={setOrigins} placeholder="Ambos orígenes" />}
                </FormField>
                <FormField label="Estado de envío">
                  {(id) => <MultiSelect id={id} options={CAMPAIGN_STATUS_OPTIONS} value={campaignStatuses} onChange={setCampaignStatuses} placeholder="Todos los estados" />}
                </FormField>
              </>
            )}

            {dataset === "CHATS" && (
              <>
                <FormField label="Estado del chat">
                  {(id) => <MultiSelect id={id} options={CHAT_STATUS_OPTIONS} value={chatStatuses} onChange={setChatStatuses} placeholder="Todos los estados" />}
                </FormField>
                <FormField label="Etiquetas">
                  {(id) => <MultiSelect id={id} options={tagOptions} value={tagIds} onChange={setTagIds} placeholder="Todas las etiquetas" />}
                </FormField>
              </>
            )}

            {dataset === "CONTACTS" && (
              <>
                <FormField label="Etiquetas">
                  {(id) => <MultiSelect id={id} options={tagOptions} value={tagIds} onChange={setTagIds} placeholder="Todas las etiquetas" />}
                </FormField>
                <FormField label="Estado de lead">
                  {(id) => <MultiSelect id={id} options={LEAD_STATUS_OPTIONS} value={leadStatuses} onChange={setLeadStatuses} placeholder="Todos los estados" />}
                </FormField>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Desde">
                {(id) => <DatePicker id={id} value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} />}
              </FormField>
              <FormField label="Hasta">
                {(id) => <DatePicker id={id} value={dateTo} onChange={setDateTo} min={dateFrom || undefined} />}
              </FormField>
            </div>

            {(dataset === "CHATS" || dataset === "CONTACTS") && !dateFrom && !dateTo && (
              <p className="text-xs text-muted-darker">
                Sugerencia: agrega un rango de fechas para exportaciones grandes sin filtrar — la hoja tiene un límite práctico de filas.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
