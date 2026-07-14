"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Bot, Power, PowerOff, Trash2, Settings } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { TileGrid } from "@/app/components/ui/tile-grid";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";
import { BotFormModal } from "./_form";

interface WaBot {
  id: string;
  name: string;
  provider: string;
  model: string;
  isActive: boolean;
  status: string;
  waAccountId: string | null;
  memoryType: string;
  ragEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null } | null;
  _count: { conversations: number; knowledgeBots: number };
}

const PROVIDER_BADGE: Record<string, { label: string; tone: "accent" | "info" }> = {
  openrouter: { label: "OpenRouter", tone: "accent" },
  google: { label: "Gemini", tone: "info" },
};

export default function BotsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [bots, setBots] = useState<WaBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

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
      <PageHeader
        title="Bots IA"
        description="Configura bots con IA para responder automáticamente mensajes de WhatsApp."
        actions={
          <Button icon={Plus} size="sm" onClick={() => setFormOpen(true)}>
            Crear bot
          </Button>
        }
      />

      <TileGrid
        rows={bots}
        rowKey={(bot) => bot.id}
        loading={loading}
        columns="3"
        emptyIcon={Bot}
        emptyTitle="Sin bots"
        emptyDescription="Crea tu primer bot de IA para automatizar conversaciones de WhatsApp."
        renderTile={(bot) => {
          const provider = PROVIDER_BADGE[bot.provider] ?? { label: bot.provider, tone: "info" as const };
          return (
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <Link href={`/whatsapp/bots/${bot.id}`} className="text-sm font-semibold text-accent hover:underline">
                    {bot.name}
                  </Link>
                  <p className="text-xs text-muted-darker mt-0.5">
                    {bot.waAccount?.name ?? "Sin cuenta (solo pruebas)"} · {bot.model}
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
                {bot.status === "ERROR" && (
                  <Badge tone="danger" size="sm">
                    Error — reactivar para reintentar
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-darker">
                <span>{bot._count.conversations} conversaciones</span>
                <span>·</span>
                <span>{bot._count.knowledgeBots} docs</span>
              </div>

              <div className="flex items-center gap-1 pt-2 border-t border-border">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  icon={Settings}
                  onClick={() => router.push(`/whatsapp/bots/${bot.id}`)}
                >
                  Configurar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setDeleteId(bot.id)}
                  className="text-muted-darker hover:text-danger"
                />
              </div>
            </div>
          );
        }}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar bot"
        description="Esta acción eliminará permanentemente el bot y todas sus conversaciones y documentos de conocimiento. No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />

      <BotFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={fetchBots}
      />
    </div>
  );
}
