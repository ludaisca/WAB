"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Eye, EyeOff } from "lucide-react";
import { Card, CardTitle, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface AISettings {
  id: string;
  openrouterApiKey: string | null;
  googleApiKey: string | null;
  defaultProvider: string;
  defaultModel: string;
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
  const [showOpenrouter, setShowOpenrouter] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);

  useEffect(() => {
    fetch("/api/configuracion/ia")
      .then(r => r.json())
      .then(d => {
        if (d.id) {
          setSettings(d);
          setDefaultProvider(d.defaultProvider || "openrouter");
          setDefaultModel(d.defaultModel || "google/gemini-2.5-flash");
        }
      })
      .catch(() => toastError("Error al cargar configuración"))
      .finally(() => setLoading(false));
  }, [toastError]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string> = { defaultProvider, defaultModel };
      if (openrouterKey.trim()) body.openrouterApiKey = openrouterKey.trim();
      if (googleKey.trim()) body.googleApiKey = googleKey.trim();

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
                    <Select id={id} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                      <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="openai/gpt-4o">GPT-4o</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                    </Select>
                  )}
                </FormField>
              </div>
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
