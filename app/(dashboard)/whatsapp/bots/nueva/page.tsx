"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, RefreshCw } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
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

export default function BotFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditing = !!editId;
  const { success, error: toastError } = useToast();

  const [name, setName] = useState("");
  const [waAccountId, setWaAccountId] = useState("");
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [memoryType, setMemoryType] = useState("RECENT");
  const [memoryLimit, setMemoryLimit] = useState("20");
  const [ragEnabled, setRagEnabled] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS.openrouter);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setAccounts(d);
      })
      .catch(() => toastError("Error al cargar cuentas"));
  }, [toastError]);

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
      setLoadingModels(false);
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/provider-change; fetchModels also used for manual refresh
    fetchModels(provider);
  }, [provider, fetchModels]);

  useEffect(() => {
    if (models.length === 0) return;
    if (!models.some((m) => m.id === model)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap to a valid model when the fetched list no longer contains the current one
      setModel(models[0].id);
    }
  }, [models, model]);

  useEffect(() => {
    if (!editId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount for edit mode
    setLoading(true);
    fetch(`/api/whatsapp/bots/${editId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.name) {
          setName(d.name);
          setWaAccountId(d.waAccountId);
          setProvider(d.provider);
          setModel(d.model);
          setSystemPrompt(d.systemPrompt);
          setTemperature(String(d.temperature ?? 0.7));
          setMaxTokens(String(d.maxTokens ?? 1024));
          setMemoryType(d.memoryType);
          setMemoryLimit(String(d.memoryLimit ?? 20));
          setRagEnabled(d.ragEnabled);
        }
      })
      .catch(() => toastError("Error al cargar bot"))
      .finally(() => setLoading(false));
  }, [editId, toastError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Requerido";
    if (!waAccountId) newErrors.waAccountId = "Selecciona una cuenta";
    if (!systemPrompt.trim()) newErrors.systemPrompt = "Requerido";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        waAccountId,
        provider,
        model,
        systemPrompt: systemPrompt.trim(),
        temperature: Number(temperature),
        maxTokens: Number(maxTokens),
        memoryType,
        memoryLimit: Number(memoryLimit),
        ragEnabled,
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
      router.push("/whatsapp/bots");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Spinner /></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/whatsapp/bots" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a bots
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">
        {isEditing ? "Editar bot" : "Crear bot"}
      </h1>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardBody>
            <div className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Nombre" required error={errors.name}>
                  {(id) => (
                    <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Soporte IA" error={errors.name} />
                  )}
                </FormField>
                <FormField label="Cuenta WhatsApp" required error={errors.waAccountId}>
                  {(id) => (
                    <Select id={id} value={waAccountId} onChange={(e) => setWaAccountId(e.target.value)} placeholder="Seleccionar cuenta" error={errors.waAccountId}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </Select>
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
                  <Textarea id={id} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Eres un asistente virtual de soporte técnico..." rows={6} error={errors.systemPrompt} />
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
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : isEditing ? "Actualizar" : "Crear bot"}
            </Button>
            <Link href="/whatsapp/bots">
              <Button type="button" variant="secondary">Cancelar</Button>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
