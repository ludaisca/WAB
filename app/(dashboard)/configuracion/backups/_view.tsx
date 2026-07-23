"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Database,
  Download,
  RotateCcw,
  Trash2,
  Upload,
  FileDown,
} from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { Select } from "@/app/components/ui/select";
import { DatePicker } from "@/app/components/ui/date-picker";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";
import { EXPORT_ENTITIES, EXPORT_ENTITY_LABELS, type ExportEntityKey } from "@/lib/backup/export-entities-shared";
import { RestoreConfirmModal } from "./_restore-confirm-modal";
import type { BackupItem, RestoreLogItem, RestorePreviewResponse } from "./_types";

const POLL_MS = 8000;

function formatBytes(value: string | null): string {
  if (!value) return "—";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  const mb = bytes / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

const BACKUP_STATUS_TONE: Record<BackupItem["status"], "neutral" | "info" | "success" | "danger"> = {
  PENDING: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

const BACKUP_TYPE_LABEL: Record<BackupItem["type"], string> = {
  MANUAL: "Manual",
  SCHEDULED: "Automático",
  PRE_RESTORE: "Seguridad (pre-restauración)",
};

export function BackupsView() {
  const { success, error: toastError } = useToast();

  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [errorBackups, setErrorBackups] = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [restoreLogs, setRestoreLogs] = useState<RestoreLogItem[]>([]);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RestorePreviewResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [historySelection, setHistorySelection] = useState("");

  const [exportEntity, setExportEntity] = useState<ExportEntityKey>("contacts");
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch("/api/configuracion/backups");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar respaldos");
      setBackups(data.backups);
      setErrorBackups(null);
    } catch (err) {
      setErrorBackups(err instanceof Error ? err.message : "Error al cargar respaldos");
    } finally {
      setLoadingBackups(false);
    }
  }, []);

  const fetchRestoreLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/configuracion/backups/restore");
      const data = await res.json();
      if (res.ok) setRestoreLogs(data.logs);
    } catch {
      // silencioso — es un panel secundario, no bloquea el resto de la página
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ambas funciones también refrescan por polling e interacción manual
    fetchBackups();
    fetchRestoreLogs();
    const interval = setInterval(() => {
      fetchBackups();
      fetchRestoreLogs();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchBackups, fetchRestoreLogs]);

  const activeRestore = restoreLogs.find((l) => l.status === "PENDING" || l.status === "RUNNING");

  async function handleCreateBackup() {
    setCreatingBackup(true);
    try {
      const res = await fetch("/api/configuracion/backups", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al iniciar el respaldo");
      success("Respaldo iniciado — se está generando en segundo plano");
      fetchBackups();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar el respaldo");
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/configuracion/backups/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al eliminar");
      success("Respaldo eliminado");
      setDeleteTarget(null);
      fetchBackups();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  async function handlePreviewFromHistory(historyId: string) {
    if (!historyId) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/configuracion/backups/restore/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al validar el respaldo");
      setPreview(data);
      setConfirmOpen(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al validar el respaldo");
    } finally {
      setPreviewLoading(false);
      setHistorySelection("");
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/configuracion/backups/restore/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Backup-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al validar el archivo subido");
      setPreview(data);
      setConfirmOpen(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al validar el archivo subido");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmRestore(confirmationPhrase: string) {
    if (!preview) return;
    setTriggering(true);
    try {
      const res = await fetch("/api/configuracion/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: preview.sourceType,
          historyId: preview.historyId,
          uploadToken: preview.uploadToken,
          sourceFilename: preview.sourceFilename,
          confirmationPhrase,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al iniciar la restauración");
      success("Restauración iniciada — el sistema entrará en mantenimiento hasta que termine");
      setConfirmOpen(false);
      setPreview(null);
      fetchRestoreLogs();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar la restauración");
    } finally {
      setTriggering(false);
    }
  }

  function handleExportDownload() {
    const params = new URLSearchParams({ entity: exportEntity, format: exportFormat });
    if (exportFrom) params.set("from", exportFrom);
    if (exportTo) params.set("to", exportTo);
    window.location.href = `/api/configuracion/backups/export?${params.toString()}`;
  }

  const columns: TableColumn<BackupItem>[] = [
    {
      key: "startedAt",
      header: "Fecha",
      render: (b) => <span className="font-mono text-xs">{formatDate(b.startedAt)}</span>,
    },
    {
      key: "type",
      header: "Tipo",
      render: (b) => <span className="text-sm">{BACKUP_TYPE_LABEL[b.type]}</span>,
    },
    {
      key: "sizeBytes",
      header: "Tamaño",
      render: (b) => <span className="font-mono text-xs">{formatBytes(b.sizeBytes)}</span>,
      hideBelow: "sm",
    },
    {
      key: "status",
      header: "Estado",
      render: (b) => (
        <Badge tone={BACKUP_STATUS_TONE[b.status]} pulse={b.status === "RUNNING"}>
          {b.status === "PENDING" && "Pendiente"}
          {b.status === "RUNNING" && "En curso"}
          {b.status === "COMPLETED" && "Completado"}
          {b.status === "FAILED" && "Fallido"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <PageHeader
        title="Backups y restauración"
        description="Respalda toda la información del sistema (base de datos + medios) o restaura un respaldo desde otra instancia."
      />

      {activeRestore && (
        <Banner tone="warning" title="Restauración en curso">
          El sistema está en modo mantenimiento mientras se restaura {activeRestore.sourceFilename}. Esto puede
          tardar varios minutos — evita cerrar esta pestaña.
        </Banner>
      )}

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Respaldo completo"
          title="Historial de respaldos"
          action={
            <Button size="sm" icon={Database} onClick={handleCreateBackup} loading={creatingBackup} disabled={!!activeRestore}>
              Generar respaldo ahora
            </Button>
          }
        />
        <p className="text-xs text-muted-darker -mt-2">
          Se genera automáticamente todos los días a las 2:00 am. Los respaldos más antiguos se eliminan solos
          para no llenar el disco — usa &quot;Descargar&quot; si quieres guardar una copia fuera del servidor.
        </p>

        <Table
          columns={columns}
          rows={backups}
          rowKey={(b) => b.id}
          loading={loadingBackups}
          error={errorBackups}
          onRetry={fetchBackups}
          emptyIcon={Archive}
          emptyTitle="Todavía no hay respaldos"
          emptyDescription="Genera el primero con el botón de arriba."
          rowActions={(b) => (
            <div className="flex flex-col text-sm">
              {b.status === "COMPLETED" && (
                <a
                  href={`/api/configuracion/backups/${b.id}/download`}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-surface-light rounded-md"
                >
                  <Download size={14} /> Descargar
                </a>
              )}
              {b.status === "COMPLETED" && (
                <button
                  onClick={() => handlePreviewFromHistory(b.id)}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-surface-light rounded-md text-left"
                >
                  <RotateCcw size={14} /> Restaurar desde este
                </button>
              )}
              {b.status !== "PENDING" && b.status !== "RUNNING" && (
                <button
                  onClick={() => setDeleteTarget(b)}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-surface-light rounded-md text-left text-danger"
                >
                  <Trash2 size={14} /> Eliminar
                </button>
              )}
            </div>
          )}
        />
        {backups.some((b) => b.status === "FAILED" && b.errorMessage) && (
          <Banner tone="danger" title="Algunos respaldos fallaron">
            {backups.find((b) => b.status === "FAILED")?.errorMessage}
          </Banner>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Migración entre servidores"
          title="Restaurar un respaldo"
          action={
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={Upload}
                onClick={() => fileInputRef.current?.click()}
                loading={previewLoading}
                disabled={!!activeRestore}
              >
                Subir archivo .tar
              </Button>
            </>
          }
        />
        <p className="text-sm text-muted-darker">
          Restaura desde un archivo generado en esta instancia (historial de arriba) o sube uno generado en otro
          servidor para migrar todos los datos hacia aquí.{" "}
          <strong className="text-foreground">Esta acción reemplaza todos los datos actuales.</strong>
        </p>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Select
            value={historySelection}
            onChange={(e) => {
              setHistorySelection(e.target.value);
              if (e.target.value) handlePreviewFromHistory(e.target.value);
            }}
            placeholder="O elige un respaldo del historial…"
            disabled={previewLoading || !!activeRestore}
            className="sm:max-w-sm"
          >
            {backups
              .filter((b) => b.status === "COMPLETED")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {formatDate(b.startedAt)} — {BACKUP_TYPE_LABEL[b.type]} ({formatBytes(b.sizeBytes)})
                </option>
              ))}
          </Select>
        </div>

        {restoreLogs.length > 0 && (
          <div className="text-xs text-muted-darker space-y-1">
            <p className="font-medium text-foreground">Últimas restauraciones:</p>
            {restoreLogs.slice(0, 5).map((l) => (
              <p key={l.id} className="font-mono">
                {formatDate(l.startedAt)} — {l.sourceFilename} — {l.status}
                {l.errorMessage ? `: ${l.errorMessage}` : ""}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Uso fuera del sistema"
          title="Exportar datos legibles"
        />
        <p className="text-sm text-muted-darker">
          Descarga una entidad en CSV o JSON para abrir en Excel o analizar fuera del sistema. Para una copia
          restaurable al 100% usa el respaldo completo de arriba.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={exportEntity} onChange={(e) => setExportEntity(e.target.value as ExportEntityKey)}>
            {EXPORT_ENTITIES.map((key) => (
              <option key={key} value={key}>
                {EXPORT_ENTITY_LABELS[key]}
              </option>
            ))}
          </Select>
          <Select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "csv" | "json")}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
          <DatePicker value={exportFrom} onChange={setExportFrom} placeholder="Desde (opcional)" />
          <DatePicker value={exportTo} onChange={setExportTo} placeholder="Hasta (opcional)" />
        </div>

        <Button size="sm" variant="secondary" icon={FileDown} onClick={handleExportDownload}>
          Descargar exportación
        </Button>
      </section>

      <RestoreConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        preview={preview}
        onConfirm={handleConfirmRestore}
        loading={triggering}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="¿Eliminar este respaldo?"
        description="El archivo se borrará del servidor de forma permanente."
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
