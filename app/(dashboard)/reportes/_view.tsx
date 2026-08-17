"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, Download, Trash2 } from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { FormField } from "@/app/components/ui/form-field";
import { DatePicker } from "@/app/components/ui/date-picker";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Tabs, type TabItem } from "@/app/components/ui/tabs";
import { useToast } from "@/app/components/ui/toast";
import type { ReportItem } from "./_types";
import { formatDateTime, dateKeyInTz } from "@/lib/timezone";
import { ReportesDashboard } from "./_dashboard";

const POLL_MS = 8000;
const DEFAULT_RANGE_DAYS = 30;

function formatBytes(value: number | null): string {
  if (!value) return "—";
  const mb = value / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatDateTime(value, { dateStyle: "medium", timeStyle: "short" });
}

// Últimos 30 días por default (CDMX) — así el dashboard no aparece vacío al
// entrar; el rango sigue siendo editable y también alimenta "Generar reporte".
function defaultDateFrom(): string {
  return dateKeyInTz(new Date(Date.now() - (DEFAULT_RANGE_DAYS - 1) * 86_400_000));
}

const REPORT_STATUS_TONE: Record<ReportItem["status"], "neutral" | "info" | "success" | "danger"> = {
  PENDING: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

const REPORT_STATUS_LABEL: Record<ReportItem["status"], string> = {
  PENDING: "Pendiente",
  RUNNING: "En curso",
  COMPLETED: "Completado",
  FAILED: "Fallido",
};

type ReportesTab = "dashboard" | "historial";

const TAB_ITEMS: TabItem[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "historial", label: "Historial de reportes" },
];

export function ReportesView() {
  const { success, error: toastError } = useToast();
  const today = dateKeyInTz(new Date());

  const [tab, setTab] = useState<ReportesTab>("dashboard");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(today);

  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [errorReports, setErrorReports] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReportItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reportes");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar reportes");
      setReports(data.reports);
      setErrorReports(null);
    } catch (err) {
      setErrorReports(err instanceof Error ? err.message : "Error al cargar reportes");
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; también refresca por polling e interacción manual
    fetchReports();
    const interval = setInterval(fetchReports, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchReports]);

  async function handleGenerate() {
    if (!dateFrom || !dateTo) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/reportes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al iniciar el reporte");
      success("Reporte iniciado — se está generando en segundo plano");
      fetchReports();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar el reporte");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reportes/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al eliminar");
      success("Reporte eliminado");
      setDeleteTarget(null);
      fetchReports();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  const columns: TableColumn<ReportItem>[] = [
    {
      key: "rangeFrom",
      header: "Rango",
      render: (r) => (
        <span className="font-mono text-xs">
          {dateKeyInTz(new Date(r.rangeFrom))} – {dateKeyInTz(new Date(new Date(r.rangeTo).getTime() - 1))}
        </span>
      ),
    },
    {
      key: "startedAt",
      header: "Generado",
      render: (r) => <span className="font-mono text-xs">{formatDate(r.startedAt)}</span>,
      hideBelow: "sm",
    },
    {
      key: "sizeBytes",
      header: "Tamaño",
      render: (r) => <span className="font-mono text-xs">{formatBytes(r.sizeBytes)}</span>,
      hideBelow: "sm",
    },
    {
      key: "status",
      header: "Estado",
      render: (r) => (
        <Badge tone={REPORT_STATUS_TONE[r.status]} pulse={r.status === "RUNNING"}>
          {REPORT_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: "createdBy",
      header: "Generado por",
      render: (r) => <span className="text-sm">{r.createdBy?.name ?? r.createdBy?.email ?? "—"}</span>,
      hideBelow: "md",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reportes"
        description="Explora las métricas del sistema para un rango de fechas, o exporta un Excel (.xlsx) completo: mensajes, campañas, leads calificados, costos de IA, chats, contactos, rendimiento de agentes y diagnóstico."
      />

      {/* Fila de rango compartida — alimenta tanto el dashboard en vivo como
          "Generar reporte", visible sin importar la pestaña activa. */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <FormField label="Desde">
          {(id) => <DatePicker id={id} value={dateFrom} onChange={setDateFrom} max={dateTo || today} />}
        </FormField>
        <FormField label="Hasta">
          {(id) => <DatePicker id={id} value={dateTo} onChange={setDateTo} min={dateFrom} max={today} />}
        </FormField>
        <Button icon={FileSpreadsheet} onClick={handleGenerate} loading={generating} disabled={!dateFrom || !dateTo}>
          Generar reporte .xlsx
        </Button>
      </div>

      <Tabs items={TAB_ITEMS} value={tab} onChange={(v) => setTab(v as ReportesTab)} aria-label="Secciones de reportes" />

      {tab === "dashboard" && <ReportesDashboard dateFrom={dateFrom} dateTo={dateTo} />}

      {tab === "historial" && (
        <section className="space-y-4">
          <p className="text-xs text-muted-darker">
            El archivo se arma en segundo plano — esta lista se actualiza sola y avisa por notificación cuando esté listo.
          </p>

          <Table
            columns={columns}
            rows={reports}
            rowKey={(r) => r.id}
            loading={loadingReports}
            error={errorReports}
            onRetry={fetchReports}
            emptyIcon={FileSpreadsheet}
            emptyTitle="Todavía no hay reportes"
            emptyDescription="Elige un rango de fechas arriba y genera el primero."
            rowActions={(r) => (
              <div className="flex flex-col text-sm">
                {r.status === "COMPLETED" && (
                  <a
                    href={`/api/reportes/${r.id}/download`}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-surface-light rounded-md"
                  >
                    <Download size={14} /> Descargar
                  </a>
                )}
                {r.status !== "PENDING" && r.status !== "RUNNING" && (
                  <button
                    onClick={() => setDeleteTarget(r)}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-surface-light rounded-md text-left text-danger"
                  >
                    <Trash2 size={14} /> Eliminar
                  </button>
                )}
              </div>
            )}
          />
          {reports.some((r) => r.status === "FAILED" && r.errorMessage) && (
            <Banner tone="danger" title="Algunos reportes fallaron">
              {reports.find((r) => r.status === "FAILED")?.errorMessage}
            </Banner>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="¿Eliminar este reporte?"
        description="El archivo se borrará del servidor de forma permanente."
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
