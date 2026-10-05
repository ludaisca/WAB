"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Workflow, ExternalLink } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";
import { formatDateTime } from "@/lib/timezone";

interface LeadSheetSource {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetName: string;
  enabled: boolean;
  lastRunAt: string | null;
  sentTotal: number;
  lastError: string | null;
  waAccount: { id: string; name: string };
  waTemplate: { id: string; name: string; language: string };
}

// Antes esta era la pestaña "Automatización" dentro de /whatsapp/campanas —
// se separó a su propia ruta para que aparezca como ítem de navegación
// propio ("Facebook Ads", sub-elemento de "Campañas" en el sidebar) en vez de
// un estado de UI dentro de otra página. El modelo (LeadSheetSource) sigue
// siendo genérico ("fuente" conectada a cualquier hoja de Google Sheets), el
// nombre "Facebook Ads" refleja el uso real del negocio (100% de las fuentes
// activas hoy vienen de formularios de Facebook Lead Ads).
export default function FacebookAdsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [sources, setSources] = useState<LeadSheetSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [accountFilter, setAccountFilter] = useState("");
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

  const accounts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of sources) byId.set(s.waAccount.id, s.waAccount.name);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const filtered = useMemo(
    () =>
      sources.filter(
        (s) =>
          (statusFilter === "all" || (statusFilter === "active") === s.enabled) &&
          (!accountFilter || s.waAccount.id === accountFilter)
      ),
    [sources, statusFilter, accountFilter]
  );

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
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Facebook Ads"
        description="Conecta la hoja de Google Sheets donde Facebook Lead Ads sincroniza tus leads y dispara la plantilla de WhatsApp automáticamente apenas aparece uno nuevo. Se revisa cada 5 minutos, dentro del horario laboral configurado en Configuración."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "paused")}
            aria-label="Filtrar por estado"
            className="w-44"
          >
            <option value="all">Todas ({sources.length})</option>
            <option value="active">Activas ({sources.filter((s) => s.enabled).length})</option>
            <option value="paused">Pausadas ({sources.filter((s) => !s.enabled).length})</option>
          </Select>
          <Select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            aria-label="Filtrar por cuenta"
            className="w-56"
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <Button href="/whatsapp/campanas/automatizacion/nueva" icon={Plus} size="sm" className="shrink-0">
          Nueva fuente
        </Button>
      </div>

      <EntityList
        rows={filtered}
        rowKey={(s) => s.id}
        loading={loading}
        emptyIcon={Workflow}
        emptyTitle={sources.length > 0 ? "Ninguna fuente coincide con el filtro" : "Sin fuentes de leads"}
        emptyDescription="Conecta una hoja de Google Sheets para disparar plantillas automáticamente a leads nuevos."
        onRowClick={(s) => router.push(`/whatsapp/campanas/automatizacion/${s.id}`)}
        renderRow={(s) => (
          <>
            <EntityRow
              leading={<EntityAvatar id={s.waAccount.id} name={s.name} size="sm" />}
              title={
                <Link
                  href={`/whatsapp/campanas/automatizacion/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-accent transition-colors"
                >
                  {s.name}
                </Link>
              }
              badges={
                <span className="flex shrink-0 items-center gap-1">
                  <Badge tone={s.enabled ? "success" : "neutral"} size="sm">{s.enabled ? "Activa" : "Pausada"}</Badge>
                  {s.lastError && <Badge tone="danger" size="sm" className="hidden md:inline-flex">Error</Badge>}
                </span>
              }
              subtitle={
                <>
                  {s.waAccount.name} · Plantilla: {s.waTemplate.name} ·{" "}
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 hover:text-accent"
                  >
                    {s.sheetName} <ExternalLink size={11} />
                  </a>
                  {s.lastError && <span className="text-danger"> · {s.lastError}</span>}
                </>
              }
              meta={
                <span className="font-mono">
                  {s.lastRunAt
                    ? `${formatDateTime(s.lastRunAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${s.sentTotal} enviado(s) en total`
                    : "Aún no ha corrido"}
                </span>
              }
            />
            <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                title="Eliminar fuente"
              />
            </span>
          </>
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
