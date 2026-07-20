"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Eye, EyeOff, RefreshCw, MessageCircleHeart } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { SkeletonDetail } from "@/app/components/ui/skeleton";
import { PageHeader } from "@/app/components/ui/page-header";
import { Switch } from "@/app/components/ui/switch";
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

interface AISettings {
  id: string;
  openrouterApiKey: string | null;
  googleApiKey: string | null;
  defaultProvider: string;
  defaultModel: string;
  monthlyBudgetUsd: number | null;
  leadRecoveryEnabled: boolean;
  leadRecoveryFirstMessageHours: number;
  leadRecoverySecondMessageHours: number | null;
  leadRecoveryBusinessHourStart: number;
  leadRecoveryBusinessHourEnd: number;
  leadRecoveryTimezone: string;
}

export default function IASettingsPage() {
  const { success, error: toastError } = useToast();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [defaultProvider, setDefaultProvider] = useState("openrouter");
  const [defaultModel, setDefaultModel] = useState("google/gemini-2.5-flash");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [showOpenrouter, setShowOpenrouter] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryFirstHours, setRecoveryFirstHours] = useState(2);
  const [recoverySecondHours, setRecoverySecondHours] = useState("12");
  const [recoveryHourStart, setRecoveryHourStart] = useState(8);
  const [recoveryHourEnd, setRecoveryHourEnd] = useState(20);
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS.openrouter);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsProvider, setModelsProvider] = useState("openrouter");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/provider-change; fetchModels also used for manual refresh
    fetchModels(defaultProvider);
  }, [defaultProvider, fetchModels]);

  useEffect(() => {
    fetch("/api/configuracion/ia")
      .then(r => r.json())
      .then(d => {
        if (d.id) {
          setSettings(d);
          setDefaultProvider(d.defaultProvider || "openrouter");
          setDefaultModel(d.defaultModel || "google/gemini-2.5-flash");
          setMonthlyBudget(d.monthlyBudgetUsd != null ? String(d.monthlyBudgetUsd) : "");
          setRecoveryEnabled(!!d.leadRecoveryEnabled);
          setRecoveryFirstHours(d.leadRecoveryFirstMessageHours ?? 2);
          setRecoverySecondHours(d.leadRecoverySecondMessageHours != null ? String(d.leadRecoverySecondMessageHours) : "");
          setRecoveryHourStart(d.leadRecoveryBusinessHourStart ?? 8);
          setRecoveryHourEnd(d.leadRecoveryBusinessHourEnd ?? 20);
        }
      })
      .catch(() => toastError("Error al cargar configuración"))
      .finally(() => { setLoading(false); setSettingsLoaded(true); });
  }, [toastError]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (modelsProvider !== defaultProvider) return;
    if (models.length === 0) return;
    if (!models.some((m) => m.id === defaultModel)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap to a valid model when the fetched list no longer contains the current one
      setDefaultModel(models[0].id);
    }
  }, [models, modelsProvider, defaultProvider, defaultModel, settingsLoaded]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string | number | null> = { defaultProvider, defaultModel };
      if (openrouterKey.trim()) body.openrouterApiKey = openrouterKey.trim();
      if (googleKey.trim()) body.googleApiKey = googleKey.trim();
      body.monthlyBudgetUsd = monthlyBudget.trim() ? Number(monthlyBudget) : null;

      const res = await fetch("/api/configuracion/ia", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      success("Configuración guardada");
      setOpenrouterKey("");
      setGoogleKey("");
      setShowOpenrouter(false);
      setShowGoogle(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRecovery() {
    setSavingRecovery(true);
    try {
      const res = await fetch("/api/configuracion/ia", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadRecoveryEnabled: recoveryEnabled,
          leadRecoveryFirstMessageHours: recoveryFirstHours,
          leadRecoverySecondMessageHours: recoverySecondHours.trim() ? Number(recoverySecondHours) : null,
          leadRecoveryBusinessHourStart: recoveryHourStart,
          leadRecoveryBusinessHourEnd: recoveryHourEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("Configuración de recuperación de leads guardada");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingRecovery(false);
    }
  }

  if (loading) return <div className="space-y-6 max-w-2xl mx-auto"><SkeletonDetail cards={2} /></div>;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Link href="/configuracion" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a configuración
      </Link>
      <PageHeader
        title="Configuración IA"
        description="Administra las API keys y preferencias de los proveedores de inteligencia artificial."
      />

      <Card>
        <form onSubmit={handleSave}>
          <CardBody>
            <div className="space-y-5">
              <FormField label="OpenRouter API Key" hint="Usada para acceder a modelos vía OpenRouter (Gemini, GPT-4, Claude, etc.)">
                {(id) => (
                  <div className="relative">
                    <Input
                      id={id}
                      type={showOpenrouter ? "text" : "password"}
                      value={openrouterKey}
                      onChange={(e) => setOpenrouterKey(e.target.value)}
                      placeholder={settings?.openrouterApiKey ? "•••••••• (configurada)" : "sk-or-..."}
                    />
                    <button
                      type="button"
                      onClick={() => setShowOpenrouter(!showOpenrouter)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-darker hover:text-foreground"
                    >
                      {showOpenrouter ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                )}
              </FormField>

              <FormField label="Google AI API Key" hint="Usada para acceder directamente a modelos Gemini">
                {(id) => (
                  <div className="relative">
                    <Input
                      id={id}
                      type={showGoogle ? "text" : "password"}
                      value={googleKey}
                      onChange={(e) => setGoogleKey(e.target.value)}
                      placeholder={settings?.googleApiKey ? "•••••••• (configurada)" : "AIza..."}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGoogle(!showGoogle)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-darker hover:text-foreground"
                    >
                      {showGoogle ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                )}
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Proveedor por defecto">
                  {(id) => (
                    <Select id={id} value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value)}>
                      <option value="openrouter">OpenRouter</option>
                      <option value="google">Google Gemini</option>
                    </Select>
                  )}
                </FormField>
                <FormField label="Modelo por defecto">
                  {(id) => (
                    <div className="space-y-1">
                      <Select id={id} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} disabled={loadingModels}>
                        {!models.some((m) => m.id === defaultModel) && (
                          <option value={defaultModel}>{defaultModel}</option>
                        )}
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>
                      <button
                        type="button"
                        onClick={() => fetchModels(defaultProvider)}
                        disabled={loadingModels}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
                      >
                        <RefreshCw size={11} className={loadingModels ? "animate-spin" : ""} />
                        Actualizar lista desde {defaultProvider === "google" ? "Google" : "OpenRouter"}
                      </button>
                    </div>
                  )}
                </FormField>
              </div>

              <FormField label="Presupuesto mensual de IA (USD)" hint="Opcional. Recibirás una notificación cuando el costo estimado del mes supere este monto.">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                    placeholder="Sin límite"
                  />
                )}
              </FormField>
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : "Guardar"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircleHeart size={16} className="text-accent" />
            <CardTitle>Recuperación de leads</CardTitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Reactivar leads que dejan de responder</p>
                <p className="text-xs text-muted-darker">
                  Cuando un lead se queda &quot;en visto&quot;, el mismo bot de esa cuenta le manda hasta 2 mensajes de seguimiento, generados con IA y coherentes con la conversación.
                </p>
              </div>
              <Switch checked={recoveryEnabled} onCheckedChange={setRecoveryEnabled} />
            </div>

            {recoveryEnabled && (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Horas de silencio para el mensaje 1" hint="Medido desde el último mensaje del lead">
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min="1"
                        value={recoveryFirstHours}
                        onChange={(e) => setRecoveryFirstHours(Number(e.target.value))}
                      />
                    )}
                  </FormField>
                  <FormField label="Horas de silencio para el mensaje 2" hint="Vacío = solo se manda 1 mensaje">
                    {(id) => (
                      <Input
                        id={id}
                        type="number"
                        min="1"
                        value={recoverySecondHours}
                        onChange={(e) => setRecoverySecondHours(e.target.value)}
                        placeholder="Deshabilitado"
                      />
                    )}
                  </FormField>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Horario de negocio — desde">
                    {(id) => (
                      <Select id={id} value={String(recoveryHourStart)} onChange={(e) => setRecoveryHourStart(Number(e.target.value))}>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label="Horario de negocio — hasta">
                    {(id) => (
                      <Select id={id} value={String(recoveryHourEnd)} onChange={(e) => setRecoveryHourEnd(Number(e.target.value))}>
                        {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                          <option key={h} value={h}>{String(h % 24).padStart(2, "0")}:00</option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                </div>
                <p className="text-[11px] text-muted-darker">
                  Solo se envían mensajes de texto libre dentro de la ventana de 24h de Meta (desde el último mensaje del lead). Si ya pasaron más de 24h, el sistema no manda nada — no hay plantilla de reactivación configurada todavía. Respeta el presupuesto mensual de IA de arriba.
                </p>
              </>
            )}

            <div className="pt-1">
              <Button size="sm" variant="secondary" icon={savingRecovery ? undefined : Save} onClick={handleSaveRecovery} disabled={savingRecovery}>
                {savingRecovery ? <Spinner /> : "Guardar recuperación de leads"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
