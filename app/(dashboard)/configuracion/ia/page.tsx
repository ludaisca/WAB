"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
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

interface AISettings {
  id: string;
  openrouterApiKey: string | null;
  googleApiKey: string | null;
  defaultProvider: string;
  defaultModel: string;
  monthlyBudgetUsd: number | null;
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
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS.openrouter);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchModels = useCallback(async (p: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/configuracion/ia/models?provider=${p}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setModels(data);
      } else {
        setModels(FALLBACK_MODELS[p] ?? []);
      }
    } catch {
      setModels(FALLBACK_MODELS[p] ?? []);
    } finally {
      setLoadingModels(false);
    }
  }, []);

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
        }
      })
      .catch(() => toastError("Error al cargar configuración"))
      .finally(() => setLoading(false));
  }, [toastError]);

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

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/configuracion" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a configuración
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración IA</h1>
        <p className="mt-1 text-sm text-muted">Administra las API keys y preferencias de los proveedores de inteligencia artificial.</p>
      </div>

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
    </div>
  );
}
