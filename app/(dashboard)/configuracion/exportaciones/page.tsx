"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, FileSpreadsheet, Pencil, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { Button } from "@/app/components/ui/button";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";
import { DATASET_LABELS } from "@/lib/whatsapp/sheet-export-access";
import { SheetExportFormModal, type SheetExportRow } from "./_form";

const DATASET_BADGE_TONE: Record<string, "info" | "accent" | "warning" | "success"> = {
  LEAD_SCORES: "accent",
  CAMPAIGN_RESULTS: "info",
  CHATS: "success",
  CONTACTS: "warning",
};

export default function ExportacionesPage() {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<SheetExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/sheet-exports");
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
      else throw new Error(data.error ?? "Error al cargar exportaciones");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar exportaciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchItems también se usa para refrescar manualmente
    fetchItems();
  }, [fetchItems]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/sheet-exports/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Exportación eliminada");
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  const handleToggle = useCallback(async (item: SheetExportRow) => {
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/whatsapp/sheet-exports/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, enabled: data.enabled } : i)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setTogglingId(null);
    }
  }, [toastError]);

  const handleSyncNow = useCallback(async (item: SheetExportRow) => {
    setSyncingId(item.id);
    try {
      const res = await fetch(`/api/whatsapp/sheet-exports/${item.id}/sync-now`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al sincronizar");
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, lastSyncedAt: data.lastSyncedAt, lastSyncError: data.lastSyncError } : i))
      );
      if (data.lastSyncError) toastError(data.lastSyncError);
      else success("Exportación sincronizada");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncingId(null);
    }
  }, [success, toastError]);

  const editingRow = editId ? items.find((i) => i.id === editId) ?? null : null;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Volver a configuración
      </Link>

      <PageHeader
        title="Exportaciones a Google Sheets"
        description="Elige qué datos van a cada hoja — crea tantas exportaciones como necesites, cada una con sus propias columnas y filtros."
        actions={
          <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
            Nueva exportación
          </Button>
        }
      />

      <EntityList
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={fetchError}
        onRetry={fetchItems}
        onRowClick={(r) => { setEditId(r.id); setModalOpen(true); }}
        emptyIcon={FileSpreadsheet}
        emptyTitle="Sin exportaciones"
        emptyDescription="Crea tu primera exportación para empezar a mandar datos a una hoja de Google."
        emptyAction={
          <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
            Nueva exportación
          </Button>
        }
        renderRow={(r) => (
          <>
            <EntityRow
              title={r.name}
              badges={
                <Badge tone={DATASET_BADGE_TONE[r.dataset] ?? "neutral"} size="sm">
                  {DATASET_LABELS[r.dataset] ?? r.dataset}
                </Badge>
              }
              subtitle={
                r.lastSyncError ? (
                  <span className="text-danger">{r.sheetName} · {r.lastSyncError}</span>
                ) : (
                  r.sheetName
                )
              }
              meta={
                <span className="font-mono">
                  {r.lastSyncedAt
                    ? new Date(r.lastSyncedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
                    : "Nunca sincronizada"}
                </span>
              }
            />
            <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Switch checked={r.enabled} onCheckedChange={() => handleToggle(r)} disabled={togglingId === r.id} />
            </span>
          </>
        )}
        rowActions={(r) => (
          <>
            <DropdownItem icon={RefreshCw} onClick={() => handleSyncNow(r)} disabled={syncingId === r.id}>
              Sincronizar ahora
            </DropdownItem>
            <DropdownItem
              icon={ExternalLink}
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${r.spreadsheetId}`, "_blank", "noopener,noreferrer")}
            >
              Abrir hoja
            </DropdownItem>
            <DropdownItem icon={Pencil} onClick={() => { setEditId(r.id); setModalOpen(true); }}>
              Editar
            </DropdownItem>
            <DropdownItem icon={Trash2} onClick={() => setDeleteId(r.id)}>
              Eliminar
            </DropdownItem>
          </>
        )}
      />

      <SheetExportFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editId={editId}
        initialData={editingRow}
        onSaved={fetchItems}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar exportación"
        description="Se dejará de sincronizar esta exportación. La información ya escrita en la hoja de Google no se borra."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
