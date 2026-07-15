"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { useToast } from "@/app/components/ui/toast";
import { LEAD_SCORER_SCHEDULE_INTERVALS } from "@/lib/validations";

interface ModelOption { id: string; name: string; }
interface AccountOption { id: string; name: string; }

const INTERVAL_LABEL: Record<number, string> = {
  15: "Cada 15 minutos",
  30: "Cada 30 minutos",
  60: "Cada hora",
  180: "Cada 3 horas",
  360: "Cada 6 horas",
  720: "Cada 12 horas",
  1440: "Cada 24 horas",
};

const FALLBACK_MODELS: Record<string, ModelOption[]> = {
  openrouter: [
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
  ],
  google: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
};

interface Props {
  open: boolean;
  onClose: () => void;
  editId?: string | null;
  onSaved: () => void;
}

export function LeadScorerFormModal({ open, onClose, editId = null, onSaved }: Props) {
  const isEditing = !!editId;
  const { success, error: toastError } = useToast();

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(30);
  const [scheduleAccountIds, setScheduleAccountIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS.openrouter);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsProvider, setModelsProvider] = useState("openrouter");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const resetForm = useCallback(() => {
    setName("");
    setProvider("openrouter");
    setModel("google/gemini-2.5-flash");
    setSystemPrompt("");
    setIsActive(true);
    setScheduleEnabled(false);
    setScheduleIntervalMinutes(30);
    setScheduleAccountIds([]);
    setErrors({});
    setError("");
  }, []);

  const fetchModels = useCallback(async (p: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/configuracion/ia/models?provider=${p}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setModels(data);
      } else {
        setModels(FALLBACK_MODELS[p] ?? []);
        toastError(data.error ?? "No se pudo obtener la lista de modelos del proveedor, mostrando lista de respaldo");
      }
    } catch {
      setModels(FALLBACK_MODELS[p] ?? []);
      toastError("No se pudo obtener la lista de modelos del proveedor, mostrando lista de respaldo");
    } finally {
      setModelsProvider(p);
      setLoadingModels(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open/provider-change; fetchModels also used for manual refresh
    fetchModels(provider);
  }, [open, provider, fetchModels]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setAccounts(d.map((a) => ({ id: a.id, name: a.name })));
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (modelsProvider !== provider) return;
    if (models.length === 0) return;
    if (!models.some((m) => m.id === model)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap to a valid model when the fetched list no longer contains the current one
      setModel(models[0].id);
    }
  }, [models, model, provider, modelsProvider]);

  useEffect(() => {
    if (!open || !editId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-open for edit mode
    setLoading(true);
    fetch(`/api/whatsapp/lead-scorers/${editId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.name) {
          setName(d.name);
          setProvider(d.provider);
          setModel(d.model);
          setSystemPrompt(d.systemPrompt);
          setIsActive(d.isActive);
          setScheduleEnabled(d.scheduleEnabled ?? false);
          setScheduleIntervalMinutes(d.scheduleIntervalMinutes ?? 30);
          setScheduleAccountIds(d.scheduleAccountIds ?? []);
        }
      })
      .catch(() => toastError("Error al cargar el calificador"))
      .finally(() => setLoading(false));
  }, [open, editId, toastError]);

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Requerido";
    if (!systemPrompt.trim()) newErrors.systemPrompt = "Requerido";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setError("");
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        provider,
        model,
        systemPrompt: systemPrompt.trim(),
        isActive,
        scheduleEnabled,
        scheduleIntervalMinutes: scheduleEnabled ? scheduleIntervalMinutes : null,
        scheduleAccountIds: scheduleEnabled ? scheduleAccountIds : [],
      };

      const url = isEditing ? `/api/whatsapp/lead-scorers/${editId}` : "/api/whatsapp/lead-scorers";
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");

      success(isEditing ? "Calificador actualizado" : "Calificador creado exitosamente");
      resetForm();
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEditing ? "Editar calificador" : "Crear calificador"}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving ? <Spinner /> : isEditing ? "Actualizar" : "Crear calificador"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {error && <Banner tone="danger">{error}</Banner>}

          <FormField label="Nombre" required error={errors.name}>
            {(id) => (
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Calificador bienes raíces" error={errors.name} />
            )}
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Proveedor IA" required>
              {(id) => (
                <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="openrouter">OpenRouter</option>
                  <option value="google">Google Gemini</option>
                </Select>
              )}
            </FormField>
            <FormField label="Modelo" required>
              {(id) => (
                <div className="space-y-1">
                  <Select id={id} value={model} onChange={(e) => setModel(e.target.value)} disabled={loadingModels}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => fetchModels(provider)}
                    disabled={loadingModels}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={loadingModels ? "animate-spin" : ""} />
                    Actualizar lista desde {provider === "google" ? "Google" : "OpenRouter"}
                  </button>
                </div>
              )}
            </FormField>
          </div>

          <FormField
            label="Prompt de calificación"
            required
            error={errors.systemPrompt}
            hint="Escribe libremente cómo debe analizar las conversaciones: qué buscar, qué cuenta como interés/urgencia/presupuesto para tu negocio. La app siempre exige la respuesta en un formato fijo (score, etiqueta, resumen y motivos), así que no necesitas especificar el formato de salida."
          >
            {(id) => (
              <Textarea id={id} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Eres un analista de ventas de [tu negocio]. Evalúa qué tan calificado está el lead considerando..." rows={8} error={errors.systemPrompt} />
            )}
          </FormField>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Activo</p>
              <p className="text-xs text-muted-darker">Solo los calificadores activos aparecen para elegir al calificar un chat.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Ejecución automática</p>
                <p className="text-xs text-muted-darker">
                  Vuelve a calificar los chats abiertos/pendientes con mensajes nuevos, de forma periódica, sin intervención manual.
                </p>
              </div>
              <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
            </div>
            {scheduleEnabled && (
              <>
                <FormField label="Frecuencia" required error={errors.scheduleIntervalMinutes}>
                  {(id) => (
                    <Select
                      id={id}
                      value={String(scheduleIntervalMinutes)}
                      onChange={(e) => setScheduleIntervalMinutes(Number(e.target.value))}
                    >
                      {LEAD_SCORER_SCHEDULE_INTERVALS.map((m) => (
                        <option key={m} value={m}>{INTERVAL_LABEL[m]}</option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  label="Cuentas a calificar"
                  hint="Deja vacío para calificar automáticamente en todas tus cuentas. Selecciona una o varias para limitar el barrido a solo esas."
                >
                  {(id) => (
                    <MultiSelect
                      id={id}
                      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                      value={scheduleAccountIds}
                      onChange={setScheduleAccountIds}
                      placeholder="Todas las cuentas"
                    />
                  )}
                </FormField>
              </>
            )}
            <p className="text-[11px] text-muted-darker">
              Respeta el presupuesto mensual de IA configurado en Configuración: si ya se superó, las ejecuciones automáticas se omiten hasta el mes siguiente.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
