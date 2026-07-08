"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Bot, Power, PowerOff, Trash2, Settings } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";

interface WaBot {
  id: string;
  name: string;
  provider: string;
  model: string;
  isActive: boolean;
  status: string;
  waAccountId: string;
  memoryType: string;
  ragEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  _count: { conversations: number; knowledgeBots: number };
}

const PROVIDER_BADGE: Record<string, { label: string; tone: "accent" | "info" }> = {
  openrouter: { label: "OpenRouter", tone: "accent" },
  google: { label: "Gemini", tone: "info" },
};

export default function BotsPage() {
  const { success, error: toastError } = useToast();
  const [bots, setBots] = useState<WaBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchBots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/bots");
      const data = await res.json();
      if (Array.isArray(data)) setBots(data);
    } catch {
      toastError("Error al cargar bots");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchBots also used for manual refresh
  useEffect(() => { fetchBots(); }, [fetchBots]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/bots/${deleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      success("Bot eliminado");
      setBots((prev) => prev.filter((b) => b.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  async function handleToggle(botId: string) {
    setTogglingId(botId);
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBots((prev) =>
        prev.map((b) => (b.id === botId ? { ...b, isActive: data.isActive, status: data.status } : b))
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cambiar estado");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bots IA</h1>
          <p className="mt-1 text-sm text-muted">Configura bots con IA para responder automáticamente mensajes de WhatsApp.</p>
        </div>
        <Link href="/whatsapp/bots/nueva">
          <Button icon={Plus} size="sm">Crear bot</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner /></div>
      ) : bots.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="Sin bots"
          description="Crea tu primer bot de IA para automatizar conversaciones de WhatsApp."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => {
            const provider = PROVIDER_BADGE[bot.provider] ?? { label: bot.provider, tone: "info" as const };
            return (
              <Card key={bot.id}>
                <CardBody>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <Link href={`/whatsapp/bots/${bot.id}`} className="text-sm font-semibold text-accent hover:underline">
                          {bot.name}
                        </Link>
                        <p className="text-xs text-muted-darker mt-0.5">
                          {bot.waAccount.name} · {bot.model}
                        </p>
                      </div>
                      <button
                        onClick={() => handleToggle(bot.id)}
                        disabled={togglingId === bot.id}
                        className={`p-1.5 rounded-md transition-colors ${
                          bot.isActive
                            ? "bg-success-bg text-success hover:bg-success-bg/80"
                            : "bg-surface-light text-muted-darker hover:text-foreground"
                        }`}
                        title={bot.isActive ? "Desactivar" : "Activar"}
                      >
                        {togglingId === bot.id ? (
                          <Spinner size="sm" />
                        ) : bot.isActive ? (
                          <Power size={14} />
                        ) : (
                          <PowerOff size={14} />
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={provider.tone} size="sm">{provider.label}</Badge>
                      {bot.ragEnabled && <Badge tone="success" size="sm">RAG</Badge>}
                      <Badge tone={bot.isActive ? "success" : "neutral"} size="sm">
                        {bot.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-muted-darker">
                      <span>{bot._count.conversations} conversaciones</span>
                      <span>·</span>
                      <span>{bot._count.knowledgeBots} docs</span>
                    </div>

                    <div className="flex items-center gap-1 pt-2 border-t border-border">
                      <Link href={`/whatsapp/bots/${bot.id}`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full" icon={Settings}>
                          Configurar
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={() => setDeleteId(bot.id)}
                        className="text-muted-darker hover:text-danger"
                      />
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar bot"
        description="Esta acción eliminará permanentemente el bot y todas sus conversaciones y documentos de conocimiento. No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
