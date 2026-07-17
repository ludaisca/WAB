"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Megaphone, Trash2, Eye, Workflow, ExternalLink } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Switch } from "@/app/components/ui/switch";
import { TileGrid } from "@/app/components/ui/tile-grid";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";

interface Campaign {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  createdAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  waTemplate: { id: string; name: string };
}

interface LeadSheetSource {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetName: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastImportedCount: number;
  lastError: string | null;
  waAccount: { id: string; name: string };
  waTemplate: { id: string; name: string; language: string };
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  DRAFT:     { label: "Borrador",   tone: "neutral" },
  SCHEDULED: { label: "Programada", tone: "info" },
  SENDING:   { label: "Enviando",   tone: "warning" },
  COMPLETED: { label: "Completada", tone: "success" },
  FAILED:    { label: "Fallida",    tone: "danger" },
};

const TABS = ["campanas", "automatizacion"] as const;
type Tab = (typeof TABS)[number];

export default function CampaignsPage() {
  const [tab, setTab] = useState<Tab>("campanas");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas"
        description="Envía mensajes masivos usando plantillas de WhatsApp, manualmente o disparados en automático desde una hoja de Google Sheets."
      />

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "campanas" ? "Campañas" : "Automatización"}
          </button>
        ))}
      </div>

      {tab === "campanas" ? <CampaignsTab /> : <AutomationTab />}
    </div>
  );
}

function CampaignsTab() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/campaigns");
      const data = await res.json();
      if (Array.isArray(data)) setCampaigns(data);
    } catch {
      toastError("Error al cargar campañas");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchCampaigns also used for manual refresh
  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Campaña eliminada");
      setCampaigns((prev) => prev.filter((c) => c.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button href="/whatsapp/campanas/nueva" icon={Plus} size="sm">Nueva campaña</Button>
      </div>

      <TileGrid
        rows={campaigns}
        rowKey={(c) => c.id}
        loading={loading}
        columns="2"
        emptyIcon={Megaphone}
        emptyTitle="Sin campañas"
        emptyDescription="Crea tu primera campaña de WhatsApp para enviar mensajes a múltiples destinatarios."
        renderTile={(c) => {
          const badge = STATUS_BADGE[c.status] ?? { label: c.status, tone: "neutral" as const };
          const progress = c.recipientCount > 0
            ? Math.round((c.sentCount / c.recipientCount) * 100)
            : 0;
          return (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/whatsapp/campanas/${c.id}`} className="font-semibold text-sm text-accent hover:underline truncate">
                    {c.name}
                  </Link>
                  <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                </div>
                <p className="text-xs text-muted-darker mt-1">
                  {c.waAccount.name} · Plantilla: {c.waTemplate.name}
                </p>
                {c.status !== "DRAFT" && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-darker">
                      <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span>{progress}%</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-darker">
                      <span>Env: {c.sentCount}</span>
                      <span>Entr: {c.deliveredCount}</span>
                      <span>Leídos: {c.readCount}</span>
                      {c.failedCount > 0 && <span className="text-danger">Fallos: {c.failedCount}</span>}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="secondary" size="sm" icon={Eye} onClick={() => router.push(`/whatsapp/campanas/${c.id}`)}>
                  Detalle
                </Button>
                {c.status === "DRAFT" && (
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleteId(c.id)} className="text-muted-darker hover:text-danger" />
                )}
              </div>
            </div>
          );
        }}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar campaña"
        description="Solo se pueden eliminar campañas en borrador."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function AutomationTab() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [sources, setSources] = useState<LeadSheetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/lead-sheet-sources");
      const data = await res.json();
      if (Array.isArray(data)) setSources(data);
    } catch {
      toastError("Error al cargar las fuentes de leads");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchSources also used for manual refresh
  useEffect(() => { fetchSources(); }, [fetchSources]);

  async function handleToggle(source: LeadSheetSource) {
    setTogglingId(source.id);
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al actualizar");
      }
      setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, enabled: !s.enabled } : s)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Fuente eliminada");
      setSources((prev) => prev.filter((s) => s.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-darker max-w-xl">
          Conecta una hoja de Google Sheets (por ejemplo, la que Facebook Lead Ads sincroniza por ti) y dispara
          automáticamente una plantilla apenas aparezca un lead nuevo. Se revisa cada 5 minutos, dentro del horario
          laboral configurado en Configuración.
        </p>
        <Button href="/whatsapp/campanas/automatizacion/nueva" icon={Plus} size="sm" className="shrink-0">
          Nueva fuente
        </Button>
      </div>

      <TileGrid
        rows={sources}
        rowKey={(s) => s.id}
        loading={loading}
        columns="2"
        emptyIcon={Workflow}
        emptyTitle="Sin fuentes de leads"
        emptyDescription="Conecta una hoja de Google Sheets para disparar plantillas automáticamente a leads nuevos."
        onRowClick={(s) => router.push(`/whatsapp/campanas/automatizacion/${s.id}`)}
        renderTile={(s) => (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/whatsapp/campanas/automatizacion/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-sm text-accent hover:underline truncate"
                >
                  {s.name}
                </Link>
                <Badge tone={s.enabled ? "success" : "neutral"} size="sm">{s.enabled ? "Activa" : "Pausada"}</Badge>
              </div>
              <p className="text-xs text-muted-darker mt-1">
                {s.waAccount.name} · Plantilla: {s.waTemplate.name}
              </p>
              <a
                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-darker hover:text-accent inline-flex items-center gap-1 mt-1"
              >
                {s.sheetName} <ExternalLink size={11} />
              </a>
              <div className="mt-2 text-xs text-muted-darker">
                {s.lastRunAt
                  ? `Última corrida: ${new Date(s.lastRunAt).toLocaleString("es-MX")} · ${s.lastImportedCount} enviado(s)`
                  : "Aún no ha corrido"}
              </div>
              {s.lastError && <p className="text-xs text-danger mt-1 truncate">{s.lastError}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={s.enabled}
                onCheckedChange={() => handleToggle(s)}
                disabled={togglingId === s.id}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                onClick={() => setDeleteId(s.id)}
                className="text-muted-darker hover:text-danger"
              />
            </div>
          </div>
        )}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar fuente de leads"
        description="Se dejará de revisar esta hoja. Los chats y contactos ya creados no se eliminan."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
