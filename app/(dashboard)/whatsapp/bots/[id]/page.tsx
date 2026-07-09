"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, Power, PowerOff, Send, Upload, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { Input } from "@/app/components/ui/input";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Banner } from "@/app/components/ui/banner";
import { useToast } from "@/app/components/ui/toast";

interface BotDetail {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  memoryType: string;
  memoryLimit: number;
  ragEnabled: boolean;
  isActive: boolean;
  status: string;
  waAccountId: string;
  createdAt: string;
  updatedAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  _count: { conversations: number; knowledgeBots: number };
}

interface KnowledgeDoc {
  id: string;
  title: string;
  chunkIndex: number;
  sourceName: string | null;
  createdAt: string;
}

interface UsageData {
  total: { totalTokens: number; estimatedCost: number; interactions: number };
  today: { totalTokens: number; estimatedCost: number };
  month: { totalTokens: number; estimatedCost: number };
  recent: Array<{ totalTokens: number; estimatedCost: number; createdAt: string }>;
}

const TABS = ["config", "knowledge", "test", "uso"] as const;

export default function BotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const id = params.id as string;

  const [tab, setTab] = useState<(typeof TABS)[number]>("config");
  const [bot, setBot] = useState<BotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const [knowledge, setKnowledge] = useState<KnowledgeDoc[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const [testing, setTesting] = useState(false);

  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const fetchBot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${id}`);
      const data = await res.json();
      if (res.ok) setBot(data);
    } catch { toastError("Error al cargar"); } finally { setLoading(false); }
  }, [id, toastError]);

  const fetchKnowledge = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${id}/knowledge`);
      const data = await res.json();
      if (Array.isArray(data)) setKnowledge(data);
    } catch { /* */ } finally { setKnowledgeLoading(false); }
  }, [id]);

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${id}/usage`);
      const data = await res.json();
      if (res.ok) setUsageData(data);
    } catch { /* */ } finally { setUsageLoading(false); }
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchBot also used for manual refresh
  useEffect(() => { fetchBot(); }, [fetchBot]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-tab-switch; fetchKnowledge also used for manual refresh
  useEffect(() => { if (tab === "knowledge") fetchKnowledge(); }, [tab, fetchKnowledge]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-tab-switch
  useEffect(() => { if (tab === "uso") fetchUsage(); }, [tab, fetchUsage]);

  async function handleToggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${id}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBot((prev) => prev ? { ...prev, isActive: data.isActive } : null);
      success(data.isActive ? "Bot activado" : "Bot pausado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally { setToggling(false); }
  }

  async function handleDelete() {
    try {
      await fetch(`/api/whatsapp/bots/${id}`, { method: "DELETE" });
      success("Bot eliminado");
      router.push("/whatsapp/bots");
    } catch { toastError("Error al eliminar"); } finally { setDeleteOpen(false); }
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", docTitle || selectedFile.name);
      formData.append("botIds", id);

      const res = await fetch(`/api/whatsapp/bots/${id}/knowledge/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success(`Documento indexado`);
      setSelectedFile(null);
      setDocTitle("");
      if (fileRef.current) fileRef.current.value = "";
      fetchKnowledge();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally { setUploading(false); }
  }

  async function handleDeleteDoc(kid: string) {
    setDeletingDocId(kid);
    try {
      await fetch(`/api/whatsapp/bots/${id}/knowledge/${kid}`, { method: "DELETE" });
      setKnowledge((prev) => prev.filter((k) => k.id !== kid));
      success("Documento eliminado");
    } catch { toastError("Error al eliminar"); } finally { setDeletingDocId(null); }
  }

  async function handleTest() {
    if (!testMessage.trim()) return;
    setTesting(true);
    setTestResponse("");
    try {
      const res = await fetch(`/api/whatsapp/bots/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestResponse(data.response);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error en el test");
    } finally { setTesting(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner /></div>;
  if (!bot) return <Banner tone="danger" title="Bot no encontrado">El bot solicitado no existe.</Banner>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/whatsapp/bots" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a bots
      </Link>
      {bot.status === "ERROR" && (
        <Banner tone="danger" title="Este bot dejó de responder por un error">
          Quedó marcado en estado de error tras un fallo (API key inválida, error del proveedor, etc.) y no procesará mensajes nuevos aunque esté &quot;Activo&quot;. Pausa y vuelve a activarlo para reintentar.
        </Banner>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{bot.name}</h1>
          <p className="text-sm text-muted-darker mt-1">
            {bot.waAccount.name} · {bot.provider === "openrouter" ? "OpenRouter" : "Gemini"} · {bot.model}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={bot.isActive ? PowerOff : Power}
            variant={bot.isActive ? "secondary" : "primary"}
            size="sm"
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? <Spinner /> : bot.isActive ? "Pausar" : "Activar"}
          </Button>
          <Link href={`/whatsapp/bots/nueva?edit=${bot.id}`}>
            <Button variant="secondary" size="sm">Editar</Button>
          </Link>
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => setDeleteOpen(true)} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const labels: Record<string, string> = {
            config: "Configuración",
            knowledge: "Conocimiento",
            test: "Probar",
            uso: "Uso",
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {tab === "config" && (
        <Card>
          <CardBody>
            <dl className="space-y-3">
              <Row label="Prompt del sistema" value={bot.systemPrompt} />
              <Row label="Temperatura" value={String(bot.temperature)} />
              <Row label="Max tokens" value={String(bot.maxTokens)} />
              <Row label="Memoria" value={bot.memoryType === "RECENT" ? `Reciente (${bot.memoryLimit} msgs)` : bot.memoryType === "SUMMARY" ? "Resumen acumulativo" : "Ninguna"} />
              <Row label="RAG" value={bot.ragEnabled ? "Activado" : "Desactivado"} />
              <Row label="Creado" value={new Date(bot.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })} />
            </dl>
          </CardBody>
        </Card>
      )}

      {tab === "knowledge" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Subir documento</CardTitle></CardHeader>
            <CardBody>
              <div className="space-y-3">
                <FormField label="Título">
                  {(id) => <Input id={id} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Ej: Manual de soporte" />}
                </FormField>
                <FormField label="Archivo" hint=".txt, .md, .csv, .json, .pdf (máx 10MB)">
                  {(id) => (
                    <input
                      id={id}
                      ref={fileRef}
                      type="file"
                      accept=".txt,.md,.csv,.json"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-light file:text-foreground hover:file:bg-surface file:cursor-pointer"
                    />
                  )}
                </FormField>
                <Button icon={Upload} size="sm" onClick={handleUpload} disabled={uploading || !selectedFile}>
                  {uploading ? <Spinner /> : "Indexar documento"}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documentos indexados ({knowledge.length})</CardTitle></CardHeader>
            <CardBody>
              {knowledgeLoading ? <Spinner /> : knowledge.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">Sin documentos. Sube archivos para la base de conocimiento.</p>
              ) : (
                <div className="divide-y divide-border -mx-5">
                  {knowledge.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-darker">Chunk {doc.chunkIndex}{doc.sourceName ? ` · ${doc.sourceName}` : ""} · {new Date(doc.createdAt).toLocaleDateString("es-MX")}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={deletingDocId === doc.id ? undefined : X}
                        onClick={() => handleDeleteDoc(doc.id)}
                        disabled={deletingDocId === doc.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "test" && (
        <Card>
          <CardHeader><CardTitle>Probar el bot</CardTitle></CardHeader>
          <CardBody>
            <div className="space-y-4">
              <FormField label="Mensaje de prueba">
                {(id) => (
                  <Textarea id={id} value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Escribe un mensaje para probar..." rows={3} />
                )}
              </FormField>
              <Button icon={Send} size="sm" onClick={handleTest} disabled={testing || !testMessage.trim()}>
                {testing ? <Spinner /> : "Enviar"}
              </Button>
              {testResponse && (
                <div className="p-4 bg-surface rounded-lg border border-border">
                  <p className="text-xs text-muted-darker mb-2 font-medium">Respuesta:</p>
                  <p className="text-sm whitespace-pre-wrap">{testResponse}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "uso" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardBody>
                <p className="text-xs text-muted-darker">Hoy</p>
                <p className="text-xl font-bold">{usageData?.today.totalTokens?.toLocaleString() ?? "—"}</p>
                <p className="text-xs text-muted-darker">tokens · ${(usageData?.today?.estimatedCost ?? 0).toFixed(4)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs text-muted-darker">Este mes</p>
                <p className="text-xl font-bold">{usageData?.month.totalTokens?.toLocaleString() ?? "—"}</p>
                <p className="text-xs text-muted-darker">tokens · ${(usageData?.month?.estimatedCost ?? 0).toFixed(4)}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs text-muted-darker">Total</p>
                <p className="text-xl font-bold">{usageData?.total.totalTokens?.toLocaleString() ?? "—"}</p>
                <p className="text-xs text-muted-darker">tokens · ${(usageData?.total?.estimatedCost ?? 0).toFixed(4)}</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                Últimas interacciones ({usageData?.total.interactions ?? 0} total)
              </CardTitle>
            </CardHeader>
            <CardBody>
              {usageLoading ? <Spinner /> : !usageData?.recent?.length ? (
                <p className="text-sm text-muted py-4 text-center">Sin datos de uso aún.</p>
              ) : (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-y border-border">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase">Fecha</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase">Tokens</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase">Costo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {usageData.recent.map((u, i) => (
                        <tr key={i}>
                          <td className="px-5 py-3 text-xs">
                            {new Date(u.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-4 py-3 text-xs text-right font-mono">{u.totalTokens.toLocaleString()}</td>
                          <td className="px-4 py-3 text-xs text-right font-mono">${u.estimatedCost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar bot"
        description={`¿Estás seguro de eliminar "${bot.name}"?`}
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-3">
      <dt className="text-sm text-muted-darker">{label}</dt>
      <dd className="text-sm max-w-[60%] text-right truncate">{value}</dd>
    </div>
  );
}
