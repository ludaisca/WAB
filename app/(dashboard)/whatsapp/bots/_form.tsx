"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select } from "@/app/components/ui/select";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface ModelOption { id: string; name: string; }

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

export function BotFormModal({ open, onClose, editId = null, onSaved }: Props) {
  const isEditing = !!editId;
  const { success, error: toastError } = useToast();

  const [name, setName] = useState("");
  const [waAccountIds, setWaAccountIds] = useState<string[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [memoryType, setMemoryType] = useState("RECENT");
  const [memoryLimit, setMemoryLimit] = useState("20");
  const [ragEnabled, setRagEnabled] = useState(false);
  const [humanizeEnabled, setHumanizeEnabled] = useState(false);
  const [priceLookupEnabled, setPriceLookupEnabled] = useState(false);
  const [priceLookupUrl, setPriceLookupUrl] = useState("");
  const [priceLookupParam, setPriceLookupParam] = useState("keywords");
  const [priceLookupExtraQuery, setPriceLookupExtraQuery] = useState("");
  const [priceLookupSkusText, setPriceLookupSkusText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS.openrouter);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsProvider, setModelsProvider] = useState("openrouter");

  const resetForm = useCallback(() => {
    setName("");
    setWaAccountIds([]);
    setProvider("openrouter");
    setModel("google/gemini-2.5-flash");
    setSystemPrompt("");
    setTemperature("0.7");
    setMaxTokens("1024");
    setMemoryType("RECENT");
    setMemoryLimit("20");
    setRagEnabled(false);
    setHumanizeEnabled(false);
    setPriceLookupEnabled(false);
    setPriceLookupUrl("");
    setPriceLookupParam("keywords");
    setPriceLookupExtraQuery("");
    setPriceLookupSkusText("");
    setErrors({});
    setError("");
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setAccounts(d);
      })
      .catch(() => toastError("Error al cargar cuentas"));
  }, [open, toastError]);

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
    fetch(`/api/whatsapp/bots/${editId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.name) {
          setName(d.name);
          setWaAccountIds((d.accounts ?? []).map((a: { waAccount: { id: string } }) => a.waAccount.id));
          setProvider(d.provider);
          setModel(d.model);
          setSystemPrompt(d.systemPrompt);
          setTemperature(String(d.temperature ?? 0.7));
          setMaxTokens(String(d.maxTokens ?? 1024));
          setMemoryType(d.memoryType);
          setMemoryLimit(String(d.memoryLimit ?? 20));
          setRagEnabled(d.ragEnabled);
          setHumanizeEnabled(d.humanizeEnabled ?? false);
          setPriceLookupEnabled(d.priceLookupEnabled ?? false);
          setPriceLookupUrl(d.priceLookupUrl ?? "");
          setPriceLookupParam(d.priceLookupParam ?? "keywords");
          setPriceLookupExtraQuery(d.priceLookupExtraQuery ?? "");
          setPriceLookupSkusText((d.priceLookupSkus ?? []).join("\n"));
        }
      })
      .catch(() => toastError("Error al cargar bot"))
      .finally(() => setLoading(false));
  }, [open, editId, toastError]);

  async function handleAdjustPrompt() {
    if (!systemPrompt.trim()) return;
    setAdjusting(true);
    try {
      const res = await fetch("/api/whatsapp/bots/adjust-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: systemPrompt.trim(), provider, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al ajustar el prompt");
      setSystemPrompt(data.adjustedPrompt);
      if (data.truncated) {
        toastError("El resultado se recortó para no exceder el límite de ~4000 caracteres del sistema — revisa el final del prompt.");
      } else {
        success("Prompt ajustado para este sistema");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al ajustar el prompt");
    } finally {
      setAdjusting(false);
    }
  }

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
        waAccountIds,
        provider,
        model,
        systemPrompt: systemPrompt.trim(),
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
        memoryType,
        memoryLimit: Number(memoryLimit),
        ragEnabled,
        humanizeEnabled,
        priceLookupEnabled,
        priceLookupUrl: priceLookupUrl.trim() || null,
        priceLookupParam: priceLookupParam.trim() || "keywords",
        priceLookupExtraQuery: priceLookupExtraQuery.trim() || null,
        priceLookupSkus: priceLookupSkusText.split("\n").map((v) => v.trim()).filter(Boolean),
      };

      const url = isEditing ? `/api/whatsapp/bots/${editId}` : "/api/whatsapp/bots";
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");

      success(isEditing ? "Bot actualizado" : "Bot creado exitosamente");
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
      title={isEditing ? "Editar bot" : "Crear bot"}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving ? <Spinner /> : isEditing ? "Actualizar" : "Crear bot"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {error && <Banner tone="danger">{error}</Banner>}

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Nombre" required error={errors.name}>
              {(id) => (
                <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Soporte IA" error={errors.name} />
              )}
            </FormField>
            <FormField label="Cuentas WhatsApp" hint="Opcional y puedes elegir varias — el mismo bot puede responder por distintas cuentas a la vez. Sin ninguna, el bot solo se puede usar en la pestaña «Probar».">
              {(id) => (
                <MultiSelect
                  id={id}
                  value={waAccountIds}
                  onChange={setWaAccountIds}
                  placeholder="Sin cuenta (solo pruebas)"
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                />
              )}
            </FormField>
          </div>

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

          <FormField label="Prompt del sistema" required error={errors.systemPrompt} hint="Define cómo se comportará el bot. Incluye instrucciones, tono y límites.">
            {(id) => (
              <div className="space-y-2">
                <Textarea id={id} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Eres un asistente virtual de soporte técnico..." rows={6} error={errors.systemPrompt} />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Wand2}
                  onClick={handleAdjustPrompt}
                  disabled={adjusting || !systemPrompt.trim()}
                >
                  {adjusting ? <Spinner size="sm" /> : "Ajustar prompt"}
                </Button>
                <p className="text-xs text-muted-darker">
                  ¿Pegaste un prompt de otro sistema (n8n, Make, etc.)? Este botón lo reescribe para que funcione aquí: quita formatos JSON, tools o variables que este bot no soporta, sin perder el contenido de negocio.
                </p>
              </div>
            )}
          </FormField>

          <div className="grid gap-5 sm:grid-cols-3">
            <FormField label="Temperatura" hint="0-2">
              {(id) => (
                <Input id={id} type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
              )}
            </FormField>
            <FormField label="Max tokens" hint="1-8192">
              {(id) => (
                <Input id={id} type="number" min="1" max="8192" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
              )}
            </FormField>
            <FormField label="Límite memoria" hint="Mensajes">
              {(id) => (
                <Input id={id} type="number" min="1" max="100" value={memoryLimit} onChange={(e) => setMemoryLimit(e.target.value)} />
              )}
            </FormField>
          </div>

          <div className="space-y-4">
            <FormField label="Tipo de memoria">
              {(id) => (
                <Select id={id} value={memoryType} onChange={(e) => setMemoryType(e.target.value)}>
                  <option value="NONE">Sin memoria</option>
                  <option value="RECENT">Reciente (últimos mensajes)</option>
                  <option value="SUMMARY">Resumen acumulativo</option>
                </Select>
              )}
            </FormField>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Base de conocimiento (RAG)</p>
                <p className="text-xs text-muted-darker">El bot buscará en documentos antes de responder</p>
              </div>
              <Switch checked={ragEnabled} onCheckedChange={setRagEnabled} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Humanizar respuestas</p>
                <p className="text-xs text-muted-darker">Divide respuestas largas en varios mensajes con un pequeño retraso entre cada uno, para que se sienta menos automático</p>
              </div>
              <Switch checked={humanizeEnabled} onCheckedChange={setHumanizeEnabled} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Consulta de precio en tiempo real</p>
                <p className="text-xs text-muted-darker">El bot puede consultar una API externa para dar precios reales en vez de inventarlos</p>
              </div>
              <Switch checked={priceLookupEnabled} onCheckedChange={setPriceLookupEnabled} />
            </div>
            {priceLookupEnabled && (
              <div className="space-y-4 pl-1">
                <FormField label="URL de la API" hint="GET, sin autenticación. Ej: https://crmc.limenka360.com/agents/search-product">
                  {(id) => (
                    <Input id={id} value={priceLookupUrl} onChange={(e) => setPriceLookupUrl(e.target.value)} placeholder="https://..." />
                  )}
                </FormField>
                <FormField label="Nombre del parámetro de búsqueda" hint="Query param donde el bot manda el código del producto">
                  {(id) => (
                    <Input id={id} value={priceLookupParam} onChange={(e) => setPriceLookupParam(e.target.value)} placeholder="keywords" />
                  )}
                </FormField>
                <FormField label="Parámetros fijos adicionales" hint="Query string cruda, se concatena tal cual. Ej: ejecutivephone=5636791648">
                  {(id) => (
                    <Input id={id} value={priceLookupExtraQuery} onChange={(e) => setPriceLookupExtraQuery(e.target.value)} placeholder="clave=valor&otra=valor" />
                  )}
                </FormField>
                <FormField
                  label="Códigos de producto (SKU)"
                  hint="Uno por línea: CODIGO | Descripción breve. Vacío = sin restricción, el bot usa lo que sepa por RAG."
                >
                  {(id) => (
                    <Textarea
                      id={id}
                      value={priceLookupSkusText}
                      onChange={(e) => setPriceLookupSkusText(e.target.value)}
                      placeholder={"EBIT50-1 | Ebit50 Con 1 Tx (convexo, lineal o vaginal)\nEBIT50-2 | Ebit50 Con 2 Tx"}
                      rows={4}
                    />
                  )}
                </FormField>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
