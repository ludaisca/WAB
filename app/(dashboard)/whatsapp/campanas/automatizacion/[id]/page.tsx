"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, History, Trash2, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Switch } from "@/app/components/ui/switch";
import { Spinner } from "@/app/components/ui/spinner";
import { SkeletonDetail } from "@/app/components/ui/skeleton";
import { DonutChart } from "@/app/components/ui/chart";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Banner } from "@/app/components/ui/banner";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";

interface SourceDetail {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetName: string;
  phoneColumn: string;
  nameColumn: string | null;
  dateColumn: string | null;
  bodyColumns: string[];
  headerParam: string | null;
  buttonParam: string | null;
  rotatingParamIndex: number | null;
  rotatingValues: string[];
  rotationCursor: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastImportedCount: number;
  lastError: string | null;
  createdAt: string;
  waAccount: { id: string; name: string };
  waTemplate: { id: string; name: string; language: string };
  rowCounts: { status: string; _count: { _all: number } }[];
  rotationCounts: { rotatedValue: string | null; _count: { _all: number } }[];
  recentRows: ImportedRow[];
}

interface ImportedRow {
  id: string;
  phoneNumber: string;
  status: string;
  errorMessage: string | null;
  rotatedValue: string | null;
  leadDateRaw: string | null;
  leadDate: string | null;
  importedAt: string;
}

const ROW_STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  sent: { label: "Enviado", tone: "success" },
  delivered: { label: "Entregado", tone: "success" },
  read: { label: "Leído", tone: "success" },
  failed: { label: "Fallido", tone: "danger" },
  skipped: { label: "Omitido", tone: "warning" },
  seeded: { label: "Visto al conectar", tone: "neutral" },
};

// Colores de ESTADO para la dona (no la paleta categórica): cada estado tiene un
// significado fijo. La dona lleva etiquetas directas, así que la identidad nunca
// depende solo del color. `read` y `delivered` se distinguen por tono dentro del
// verde para no fundirse entre sí.
const ROW_STATUS_COLOR: Record<string, string> = {
  sent: "var(--info)",
  delivered: "var(--success)",
  read: "var(--accent)",
  failed: "var(--danger)",
  skipped: "var(--warning)",
  seeded: "var(--muted-darker)",
};

export default function LeadSheetSourceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const id = params.id as string;

  const [source, setSource] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);

  const fetchSource = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSource(data);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [id, toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchSource also used for manual refresh
  useEffect(() => { fetchSource(); }, [fetchSource]);

  const seededCount = useMemo(
    () => source?.rowCounts.find((c) => c.status === "seeded")?._count._all ?? 0,
    [source]
  );

  const rotationTotal = useMemo(
    () => (source?.rotationCounts ?? []).reduce((sum, r) => sum + r._count._all, 0),
    [source]
  );

  // Ordenado por volumen: el desbalance se ve de un vistazo si lo hay. Los que
  // siguen en la rotación van primero para separarlos de los ya retirados.
  const rotationBreakdown = useMemo(() => {
    const active = new Set(source?.rotatingValues ?? []);
    return (source?.rotationCounts ?? [])
      .map((r) => ({
        name: r.rotatedValue ?? "—",
        count: r._count._all,
        pct: rotationTotal > 0 ? Math.round((r._count._all / rotationTotal) * 100) : 0,
        active: active.has(r.rotatedValue ?? ""),
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count);
  }, [source, rotationTotal]);

  // rowCounts ya venía del API pero solo se usaba para contar "seeded" — la
  // distribución por estado no se mostraba en ninguna parte.
  const statusSlices = useMemo(
    () =>
      (source?.rowCounts ?? []).map((c) => ({
        name: ROW_STATUS_BADGE[c.status]?.label ?? c.status,
        value: c._count._all,
        color: ROW_STATUS_COLOR[c.status] ?? "var(--muted-darker)",
      })),
    [source]
  );

  async function handleToggle() {
    if (!source) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSource((prev) => (prev ? { ...prev, enabled: data.enabled } : prev));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setToggling(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${id}/sync-now`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success(`Sincronizado: ${data.imported} enviado(s), ${data.failed} fallido(s)`);
      fetchSource();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportExisting() {
    setImportConfirmOpen(false);
    setImporting(true);
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${id}/import-existing`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success(`Histórico importado: ${data.imported} enviado(s), ${data.failed} fallido(s)`);
      fetchSource();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al importar histórico");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/whatsapp/lead-sheet-sources/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Fuente eliminada");
      router.push("/whatsapp/campanas");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    }
  }

  const rowColumns: TableColumn<ImportedRow>[] = [
    { key: "phoneNumber", header: "Teléfono", render: (r) => <span className="font-mono text-xs">{r.phoneNumber}</span> },
    {
      key: "status",
      header: "Estado",
      render: (r) => {
        const badge = ROW_STATUS_BADGE[r.status] ?? { label: r.status, tone: "neutral" as const };
        return <Badge tone={badge.tone} size="sm">{badge.label}</Badge>;
      },
    },
    ...(source?.rotatingParamIndex != null
      ? [{
          key: "rotatedValue",
          header: "Asignado a",
          render: (r: ImportedRow) => <span className="text-xs">{r.rotatedValue || "—"}</span>,
          hideBelow: "sm" as const,
        }]
      : []),
    ...(source?.dateColumn
      ? [{
          key: "leadDateRaw",
          header: "Registrado",
          // Solo se reformatea cuando el formato de la hoja era inequívoco (ver
          // parseLeadDate); si no, se muestra el texto crudo para no arriesgar una
          // lectura equivocada de fechas ambiguas (07/03 = 7 de marzo o 3 de julio).
          render: (r: ImportedRow) => (
            <span className="font-mono text-xs">
              {r.leadDate ? new Date(r.leadDate).toLocaleString("es-MX") : r.leadDateRaw || "—"}
            </span>
          ),
        }]
      : []),
    { key: "errorMessage", header: "Detalle", render: (r) => <span className="text-xs text-muted-darker">{r.errorMessage || "—"}</span>, hideBelow: "sm" },
    { key: "importedAt", header: "Sincronizado", render: (r) => <span className="text-xs text-muted-darker">{new Date(r.importedAt).toLocaleString("es-MX")}</span> },
  ];

  if (loading) {
    return <div className="space-y-6"><SkeletonDetail cards={2} /></div>;
  }
  if (!source) {
    return <p className="text-sm text-muted-darker">Fuente no encontrada.</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/whatsapp/campanas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a campañas
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{source.name}</h1>
            <Badge tone={source.enabled ? "success" : "neutral"} size="sm">{source.enabled ? "Activa" : "Pausada"}</Badge>
          </div>
          <p className="text-sm text-muted-darker mt-1">
            {source.waAccount.name} · Plantilla: {source.waTemplate.name} ({source.waTemplate.language})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={source.enabled} onCheckedChange={handleToggle} disabled={toggling} label="Activar fuente" />
          <Button variant="secondary" size="sm" icon={syncing ? undefined : RefreshCw} onClick={handleSyncNow} disabled={syncing}>
            {syncing ? <Spinner /> : "Sincronizar ahora"}
          </Button>
          <Button variant="secondary" size="sm" icon={importing ? undefined : History} onClick={() => setImportConfirmOpen(true)} disabled={importing || seededCount === 0}>
            {importing ? <Spinner /> : "Importar leads existentes"}
          </Button>
          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleteOpen(true)} className="text-muted-darker hover:text-danger" />
        </div>
      </div>

      {source.lastError && (
        <Banner tone="danger">{source.lastError}</Banner>
      )}

      {statusSlices.some((s) => s.value > 0) && (
        <Card>
          <CardHeader><CardTitle>Distribución de filas</CardTitle></CardHeader>
          <CardBody>
            {/* fold={false}: cada estado tiene significado propio; plegar el más
                pequeño en "Otros" escondería, p. ej., los fallidos. */}
            <DonutChart data={statusSlices} height={180} fold={false} totalLabel="filas" />
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Configuración</CardTitle></CardHeader>
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-darker">Hoja</dt>
                <dd>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline inline-flex items-center gap-1"
                  >
                    {source.sheetName} <ExternalLink size={12} />
                  </a>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-darker">Columna de teléfono</dt>
                <dd className="font-mono text-xs">{source.phoneColumn}</dd>
              </div>
              {source.nameColumn && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-darker">Columna de nombre</dt>
                  <dd className="font-mono text-xs">{source.nameColumn}</dd>
                </div>
              )}
              {source.dateColumn && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-darker">Columna de fecha de registro</dt>
                  <dd className="font-mono text-xs">{source.dateColumn}</dd>
                </div>
              )}
              {source.bodyColumns.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-darker">Variables del cuerpo</dt>
                  <dd className="font-mono text-xs text-right">
                    {source.bodyColumns
                      .map((c, i) => `{{${i + 1}}}=${i === source.rotatingParamIndex ? "rotación" : c}`)
                      .join(", ")}
                  </dd>
                </div>
              )}
              {source.rotatingParamIndex !== null && source.rotatingValues.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-darker">
                    Rotación en {`{{${source.rotatingParamIndex + 1}}}`}
                  </dt>
                  <dd className="text-right text-xs">
                    <span className="flex flex-wrap justify-end gap-1">
                      {source.rotatingValues.map((v, i) => (
                        <Badge key={v} tone={i === source.rotationCursor ? "success" : "neutral"}>
                          {v}
                        </Badge>
                      ))}
                    </span>
                    <span className="mt-1 block text-muted-darker">
                      Siguiente: {source.rotatingValues[source.rotationCursor % source.rotatingValues.length]}
                    </span>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-darker">Última corrida</dt>
                <dd className="text-xs">{source.lastRunAt ? new Date(source.lastRunAt).toLocaleString("es-MX") : "Nunca"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-darker">Enviados en la última corrida</dt>
                <dd className="text-xs">{source.lastImportedCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-darker">Filas vistas al conectar, sin enviar</dt>
                <dd className="text-xs">{seededCount}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-darker mt-4">
              Los cambios estructurales (cuenta, plantilla, mapeo de columnas) requieren eliminar esta fuente y crear una nueva.
            </p>
          </CardBody>
        </Card>

        {source.rotatingParamIndex !== null && source.rotationCounts.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Reparto por ejecutivo</CardTitle></CardHeader>
            <CardBody>
              <ul className="space-y-2">
                {rotationBreakdown.map((r) => (
                  <li key={r.name} className="flex items-center gap-3 text-sm">
                    <span className="flex w-32 shrink-0 items-center gap-1.5 truncate">
                      {r.name}
                      {!r.active && <Badge tone="neutral" size="sm">retirado</Badge>}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-light">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${r.pct}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-darker">
                      {r.count} ({r.pct}%)
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-darker">
                Sobre {rotationTotal} lead(s) enviados en todo el historial de esta fuente. Incluye
                nombres retirados de la rotación — las asignaciones pasadas no se reescriben.
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Actividad reciente</CardTitle></CardHeader>
          <CardBody>
            <Table
              columns={rowColumns}
              rows={source.recentRows}
              rowKey={(r) => r.id}
              emptyIcon={History}
              emptyTitle="Sin actividad todavía"
              emptyDescription="Cuando esta fuente procese leads, aparecerán aquí."
            />
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar fuente de leads"
        description="Se dejará de revisar esta hoja. Los chats y contactos ya creados no se eliminan."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={importConfirmOpen}
        onClose={() => setImportConfirmOpen(false)}
        title="Importar leads existentes"
        description={`Se enviará la plantilla "${source.waTemplate.name}" a los ${seededCount} lead(s) que ya estaban en la hoja al conectar esta fuente y que aún no han recibido nada. Esta acción no se puede deshacer.`}
        confirmLabel="Enviar a todos"
        tone="danger"
        onConfirm={handleImportExisting}
      />
    </div>
  );
}
