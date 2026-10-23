"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Plus, Target, Trash2, Sparkles, Clock, Download, RefreshCw } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { SkeletonRow } from "@/app/components/ui/skeleton";
import { Switch } from "@/app/components/ui/switch";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeader } from "@/app/components/ui/section-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Pagination } from "@/app/components/ui/pagination";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Modal } from "@/app/components/ui/modal";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Checkbox } from "@/app/components/ui/checkbox";
import { RadioGroup } from "@/app/components/ui/radio";
import { Tabs } from "@/app/components/ui/tabs";
import { useToast } from "@/app/components/ui/toast";
import { toCsv, downloadCsv } from "@/lib/csv";
import { dateKeyInTz, formatDateTime } from "@/lib/timezone";
import { EXPORT_COLUMNS, labelText, labelTone, type LeadScoreRow } from "@/lib/whatsapp/export-columns";
import { LeadScorerFormModal } from "./_form";

interface LeadScorerBot {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number | null;
  updatedAt: string;
}

const INTERVAL_LABEL: Record<number, string> = {
  15: "15 min",
  30: "30 min",
  60: "1 h",
  180: "3 h",
  360: "6 h",
  720: "12 h",
  1440: "24 h",
};

const LEADS_PAGE_SIZE = 25;

function isoDaysAgo(days: number): string {
  return dateKeyInTz(new Date(Date.now() - days * 86_400_000));
}

type Tab = "calificadores" | "leads";

export default function CalificadoresPage() {
  const { data: session } = useSession();
  // El rol "user" solo puede ver leads ya calificados, no crear/editar/programar
  // calificadores — esa pestaña ni siquiera se ofrece como opción.
  const canManageScorers = !!session?.user && session.user.role !== "user";
  const [tab, setTab] = useState<Tab>("calificadores");
  if (!session?.user) return <div className="space-y-6" aria-busy="true" aria-label="Cargando calificadores"><PageHeader title="Calificadores de Leads" /><SkeletonRow cols={3} /><SkeletonRow cols={3} /></div>;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Calificadores de Leads"
        description="Crea agentes de IA que analizan una conversación y la califican con tu propio criterio — cada uno con su prompt libre, para el negocio que vendas."
      />

      {canManageScorers && (
        <Tabs
          items={[
            { value: "calificadores", label: "Calificadores" },
            { value: "leads", label: "Leads calificados" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      )}

      {canManageScorers && tab === "calificadores" ? <CalificadoresTab /> : <LeadsTab />}
    </div>
  );
}

function CalificadoresTab() {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<LeadScorerBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [rescoreTarget, setRescoreTarget] = useState<LeadScorerBot | null>(null);
  const [rescoring, setRescoring] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/lead-scorers");
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
      else throw new Error(data.error ?? "Error al cargar calificadores");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar calificadores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchItems also used for manual refresh
    fetchItems();
  }, [fetchItems]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/lead-scorers/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Calificador eliminado");
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  async function handleRescoreAll() {
    if (!rescoreTarget) return;
    setRescoring(true);
    try {
      const res = await fetch(`/api/whatsapp/lead-scorers/${rescoreTarget.id}/rescore-all`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al iniciar la recalificación");
      success(`Recalificación iniciada para ~${data.estimatedCount} leads — corre a un ritmo controlado (evita saturar al proveedor de IA), puede tomar más de una hora en reflejarse por completo en "Leads calificados".`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar la recalificación");
    } finally {
      setRescoring(false);
      setRescoreTarget(null);
    }
  }

  const handleToggle = useCallback(async (item: LeadScorerBot) => {
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/whatsapp/lead-scorers/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: data.isActive } : i)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setTogglingId(null);
    }
  }, [toastError]);

  return (
    <>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
          Crear calificador
        </Button>
      </div>

      <EntityList
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={fetchError}
        onRetry={fetchItems}
        emptyIcon={Target}
        emptyTitle="Sin calificadores"
        emptyDescription="Crea tu primer calificador para empezar a calificar leads desde los chats."
        onRowClick={(r) => { setEditId(r.id); setModalOpen(true); }}
        renderRow={(r) => (
          <>
            <EntityRow
              leading={<EntityAvatar id={r.id} name={r.name} size="sm" />}
              title={r.name}
              badges={
                <span className="flex shrink-0 items-center gap-1">
                  <Badge tone="info" size="sm">Gemini</Badge>
                  {r.scheduleEnabled && r.scheduleIntervalMinutes && (
                    <Badge tone="accent" size="sm" icon={Clock}>
                      {INTERVAL_LABEL[r.scheduleIntervalMinutes] ?? `${r.scheduleIntervalMinutes} min`}
                    </Badge>
                  )}
                </span>
              }
              subtitle={<span className="line-clamp-1">{r.model} · {r.systemPrompt}</span>}
            />
            <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={r.isActive}
                onCheckedChange={() => handleToggle(r)}
                disabled={togglingId === r.id}
              />
            </span>
          </>
        )}
        rowActions={(r) => (
          <>
            <DropdownItem icon={RefreshCw} onClick={() => setRescoreTarget(r)}>
              Recalificar todos los leads
            </DropdownItem>
            <DropdownItem icon={Trash2} danger onClick={() => setDeleteId(r.id)}>
              Eliminar
            </DropdownItem>
          </>
        )}
      />

      <LeadScorerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editId={editId}
        onSaved={fetchItems}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar calificador"
        description="Esta acción eliminará el calificador y todos los scores que haya generado en cualquier chat. No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!rescoreTarget}
        onClose={() => setRescoreTarget(null)}
        title="Recalificar todos los leads"
        description={`Se va a re-evaluar con el prompt actual de "${rescoreTarget?.name}" cada chat calificable de sus cuentas (todo el historial, no solo lo reciente). Corre en segundo plano a un ritmo controlado para no saturar al proveedor de IA — con el volumen actual puede tomar más de una hora, y genera costo de IA por cada lead re-evaluado.`}
        confirmLabel="Recalificar todos"
        tone="danger"
        loading={rescoring}
        onConfirm={handleRescoreAll}
      />
    </>
  );
}

function LeadsTab() {
  const { error: toastError } = useToast();
  const [rows, setRows] = useState<LeadScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [options, setOptions] = useState<{ scorers: Array<{ id: string; name: string }>; accounts: Array<{ id: string; name: string }> }>({ scorers: [], accounts: [] });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const [scorerFilter, setScorerFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(30));
  const [dateTo, setDateTo] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"current" | "selected">("current");
  const [exportColumns, setExportColumns] = useState<Set<string>>(new Set(EXPORT_COLUMNS.map((c) => c.key)));

  const buildParams = useCallback(() => {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    if (scorerFilter !== "all") qs.set("scorerId", scorerFilter);
    if (labelFilter !== "all") qs.set("label", labelFilter);
    if (accountFilter !== "all") qs.set("accountId", accountFilter);
    return qs;
  }, [dateFrom, dateTo, scorerFilter, labelFilter, accountFilter]);

  const fetchRows = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setFetchError(null);
    try {
      const qs = buildParams();
      qs.set("page", String(page)); qs.set("pageSize", String(LEADS_PAGE_SIZE)); qs.set("options", "1");
      const res = await fetch(`/api/whatsapp/lead-scores?${qs}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.items)) throw new Error(data.error ?? "Error al cargar leads calificados");
      if (controller.signal.aborted) return;
      setRows(data.items); setTotal(data.total); setOptions(data.options);
      const lastPage = Math.max(1, Math.ceil(data.total / LEADS_PAGE_SIZE));
      if (page > lastPage) setPage(lastPage);
    } catch (err) {
      if (!controller.signal.aborted) setFetchError(err instanceof Error ? err.message : "Error al cargar leads calificados");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [buildParams, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter/page change; cleanup cancels the previous request.
    void fetchRows();
    return () => requestRef.current?.abort();
  }, [fetchRows]);

  const scorers = options.scorers.map(({ id, name }) => [id, name]);
  const accounts = options.accounts.map(({ id, name }) => [id, name]);
  const filtered = rows;
  const pageRows = rows;
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value); setPage(1); setSelectedIds(new Set());
  }

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filtered) next.delete(r.id);
      } else {
        for (const r of filtered) next.add(r.id);
      }
      return next;
    });
  }, [filtered, allFilteredSelected]);

  const detailRow = useMemo(() => rows.find((r) => r.id === detailId) ?? null, [rows, detailId]);

  function toggleExportColumn(key: string) {
    setExportColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleExportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const allRows: LeadScoreRow[] = [];
      // Selected rows may span pages. Fetch in bounded ID batches while the
      // "all results" export iterates every page with exactly the same filters.
      const ids = [...selectedIds];
      const batches: Array<string[] | null> = exportScope === "selected"
        ? Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, (i + 1) * 100)) : [null];
      for (const batch of batches) {
        let exportPage = 1; let expected = Infinity;
        while ((exportPage - 1) * 100 < expected) {
          const qs = buildParams(); qs.set("page", String(exportPage)); qs.set("pageSize", "100");
          if (batch) qs.set("ids", batch.join(","));
          const res = await fetch(`/api/whatsapp/lead-scores?${qs}`);
          const data = await res.json();
          if (!res.ok || !Array.isArray(data.items)) throw new Error(data.error ?? "Error al exportar");
          expected = data.total; allRows.push(...data.items); exportPage++;
          setExportProgress(`${allRows.length} registros preparados`);
          if (!data.items.length) break;
        }
      }
      const activeColumns = EXPORT_COLUMNS.filter((c) => exportColumns.has(c.key));
      const uniqueRows = [...new Map(allRows.map((row) => [row.id, row])).values()];
      downloadCsv(`leads-calificados-${dateKeyInTz(new Date())}.csv`, toCsv(activeColumns.map((c) => c.label), uniqueRows.map((r) => activeColumns.map((c) => c.get(r)))));
      setExportModalOpen(false);
    } catch (err) { toastError(err instanceof Error ? err.message : "Error al exportar"); }
    finally { setExporting(false); setExportProgress(""); }
  }

  const columns: TableColumn<LeadScoreRow>[] = useMemo(() => [
    {
      key: "select",
      header: (
        <Checkbox aria-label="Seleccionar esta página" checked={allFilteredSelected} onChange={toggleSelectAll} />
      ),
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox aria-label={`Seleccionar ${r.chat.name || r.chat.remoteJid.split("@")[0]}`} checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
        </div>
      ),
    },
    {
      key: "chat",
      header: "Lead",
      render: (r) => (
        <Link
          href={`/whatsapp/chat/${r.chat.accountId}/${r.chat.id}`}
          className="font-medium hover:text-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {r.chat.name || r.chat.remoteJid.split("@")[0]}
        </Link>
      ),
    },
    {
      key: "phone",
      header: "Teléfono",
      render: (r) => <span className="text-xs text-muted-darker">{r.chat.remoteJid.split("@")[0]}</span>,
    },
    {
      key: "account",
      header: "Cuenta",
      render: (r) => <span className="text-xs text-muted-darker">{r.chat.account.name}</span>,
    },
    {
      key: "label",
      header: "Calificación",
      render: (r) => <Badge tone={labelTone(r.label)} size="sm">{labelText(r.label)} · {r.score}/100</Badge>,
    },
    {
      key: "scorer",
      header: "Calificador",
      render: (r) => <span className="text-xs text-muted-darker">{r.scorer.name}</span>,
    },
    {
      key: "summary",
      header: "Resumen",
      render: (r) => <span className="text-sm text-muted-darker line-clamp-1">{r.summary}</span>,
    },
    {
      key: "updatedAt",
      header: "Actualizado",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (r) => (
        <span className="text-xs text-muted-darker">
          {formatDateTime(r.updatedAt)}
        </span>
      ),
    },
  ], [allFilteredSelected, selectedIds, toggleSelected, toggleSelectAll]);

  let detailReasons: string[] = [];
  try {
    detailReasons = detailRow ? JSON.parse(detailRow.reasons) : [];
  } catch {
    detailReasons = [];
  }

  return (
    <>
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Leads"
          title="Leads calificados"
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => setExportModalOpen(true)}
              disabled={total === 0 || loading}
            >
              Exportar CSV
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Select value={scorerFilter} aria-label="Calificador" onChange={(e) => changeFilter(setScorerFilter, e.target.value)} className="w-full sm:w-auto sm:min-w-[190px]">
            <option value="all">Todos los calificadores</option>
            {scorers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
          <Select value={labelFilter} aria-label="Calificación" onChange={(e) => changeFilter(setLabelFilter, e.target.value)} className="w-full sm:w-auto sm:min-w-[190px]">
            <option value="all">Todas las calificaciones</option>
            <option value="prioridad_alta">Prioridad alta</option>
            <option value="oportunidad">Oportunidad</option>
            <option value="interesado">Interesado</option>
            <option value="frio">Frío</option>
            <option value="descartado">Descartado</option>
          </Select>
          <Select value={accountFilter} aria-label="Cuenta" onChange={(e) => changeFilter(setAccountFilter, e.target.value)} className="w-full sm:w-auto sm:min-w-[170px]">
            <option value="all">Todas las cuentas</option>
            {accounts.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
          <div className="flex gap-2 w-full sm:w-auto">
            <DatePicker value={dateFrom} onChange={(value) => changeFilter(setDateFrom, value)} placeholder="Desde" max={dateTo || undefined} />
            <DatePicker value={dateTo} onChange={(value) => changeFilter(setDateTo, value)} placeholder="Hasta" min={dateFrom || undefined} />
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-sm text-muted" aria-live="polite">
          <span>{loading ? "Buscando leads…" : `${total.toLocaleString("es-MX")} calificaciones encontradas`}</span>
          <span className="text-xs">Selección por página · puedes conservarla al avanzar</span>
        </div>

        {selectedIds.size > 0 && (
          <p className="text-xs text-muted-darker">{selectedIds.size} lead(s) seleccionado(s).</p>
        )}

        <div>
          <Table
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            loading={loading}
            error={fetchError}
            onRetry={fetchRows}
            onRowClick={(r) => setDetailId(r.id)}
            emptyIcon={Sparkles}
            emptyTitle="Sin leads calificados"
            emptyDescription="Los chats que califiques manualmente o mediante ejecución automática aparecerán aquí."
            mobileCard={(r) => {
              const label = columns.find((c) => c.key === "label")!;
              return (
                <div className="flex items-start gap-3 min-w-0 w-full">
                  <div onClick={(e) => e.stopPropagation()} className="pt-0.5 shrink-0">
                    <Checkbox aria-label={`Seleccionar ${r.chat.name || r.chat.remoteJid.split("@")[0]}`} checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{r.chat.name || r.chat.remoteJid.split("@")[0]}</span>
                      {label.render(r)}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-darker">
                      <span>{r.chat.remoteJid.split("@")[0]}</span>
                      <span>·</span>
                      <span className="truncate">{r.chat.account.name}</span>
                      <span>·</span>
                      <span className="truncate">{r.scorer.name}</span>
                    </div>
                    <p className="text-xs text-muted-darker line-clamp-2">{r.summary}</p>
                    <p className="text-[11px] text-muted-darker">
                      {formatDateTime(r.updatedAt)}
                    </p>
                  </div>
                </div>
              );
            }}
          />
          {totalPages > 1 && (
            <div className="flex justify-center mt-4 pt-4 border-t border-border">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!detailRow}
        onClose={() => setDetailId(null)}
        title={detailRow ? (detailRow.chat.name || detailRow.chat.remoteJid.split("@")[0]) : undefined}
        size="lg"
      >
        {detailRow && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={labelTone(detailRow.label)}>{labelText(detailRow.label)} · {detailRow.score}/100</Badge>
              <span className="text-xs text-muted-darker">
                {formatDateTime(detailRow.updatedAt, { dateStyle: "long", timeStyle: "short" })}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-darker">Cuenta</dt>
                <dd>{detailRow.chat.account.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-darker">Teléfono</dt>
                <dd>{detailRow.chat.remoteJid.split("@")[0]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-darker">Calificador</dt>
                <dd>{detailRow.scorer.name}</dd>
              </div>
              {detailRow.details?.nombre_real && (
                <div>
                  <dt className="text-xs text-muted-darker">Nombre real</dt>
                  <dd>{detailRow.details.nombre_real}</dd>
                </div>
              )}
              {detailRow.details?.producto_interes && (
                <div>
                  <dt className="text-xs text-muted-darker">Producto de interés</dt>
                  <dd>{detailRow.details.producto_interes}</dd>
                </div>
              )}
              {detailRow.details?.urgencia && (
                <div>
                  <dt className="text-xs text-muted-darker">Urgencia</dt>
                  <dd>{detailRow.details.urgencia}</dd>
                </div>
              )}
              {detailRow.details?.presupuesto && (
                <div>
                  <dt className="text-xs text-muted-darker">Presupuesto</dt>
                  <dd>{detailRow.details.presupuesto}</dd>
                </div>
              )}
              {detailRow.details?.tono_interes && (
                <div>
                  <dt className="text-xs text-muted-darker">Tono de interés</dt>
                  <dd className="capitalize">{detailRow.details.tono_interes}</dd>
                </div>
              )}
              {/* Estos 4 campos ya venían en el contrato JSON del calificador
                  (lib/whatsapp/lead-scoring.ts) y en el export CSV, pero nunca
                  se habían pintado en ningún lado del app. */}
              {detailRow.details?.tipo_lead && (
                <div>
                  <dt className="text-xs text-muted-darker">Tipo de lead</dt>
                  <dd>{detailRow.details.tipo_lead}</dd>
                </div>
              )}
              {detailRow.details?.nivel_interaccion && (
                <div>
                  <dt className="text-xs text-muted-darker">Nivel de interacción</dt>
                  <dd className="capitalize">{detailRow.details.nivel_interaccion}</dd>
                </div>
              )}
              {detailRow.details?.necesidad_principal && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-darker">Necesidad principal</dt>
                  <dd>{detailRow.details.necesidad_principal}</dd>
                </div>
              )}
              {detailRow.details?.contexto_negocio && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-darker">Contexto de negocio</dt>
                  <dd>{detailRow.details.contexto_negocio}</dd>
                </div>
              )}
            </dl>
            <div>
              <p className="text-xs text-muted-darker mb-1">Resumen del análisis</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{detailRow.summary}</p>
            </div>
            {detailReasons.length > 0 && (
              <div>
                <p className="text-xs text-muted-darker mb-1">Motivos</p>
                <ul className="text-sm text-foreground list-disc pl-4 space-y-1">
                  {detailReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.details && detailRow.details.senales_compra.length > 0 && (
              <div>
                <p className="text-xs text-success mb-1">Señales de compra</p>
                <ul className="text-sm text-foreground list-disc pl-4 space-y-1">
                  {detailRow.details.senales_compra.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.details && detailRow.details.objeciones_dudas.length > 0 && (
              <div>
                <p className="text-xs text-danger mb-1">Objeciones / dudas</p>
                <ul className="text-sm text-foreground list-disc pl-4 space-y-1">
                  {detailRow.details.objeciones_dudas.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.details && detailRow.details.proximos_pasos.length > 0 && (
              <div>
                <p className="text-xs text-accent mb-1">Próximos pasos sugeridos</p>
                <ul className="text-sm text-foreground list-disc pl-4 space-y-1">
                  {detailRow.details.proximos_pasos.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            <Link
              href={`/whatsapp/chat/${detailRow.chat.accountId}/${detailRow.chat.id}`}
              className="inline-flex text-sm text-accent hover:underline"
            >
              Ir al chat →
            </Link>
          </div>
        )}
      </Modal>

      <Modal
        open={exportModalOpen}
        onClose={() => { if (!exporting) setExportModalOpen(false); }}
        title="Exportar CSV"
        size="md"
        footer={
          <>
            <Button variant="secondary" disabled={exporting} onClick={() => setExportModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleExportCsv}
              loading={exporting}
              disabled={exportColumns.size === 0 || (exportScope === "selected" && selectedIds.size === 0)}
            >
              Exportar
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {exporting && <Banner tone="info">{exportProgress || "Preparando exportación…"}</Banner>}
          <div>
            <p className="text-sm font-medium mb-2">Qué exportar</p>
            <RadioGroup
              name="export-scope"
              value={exportScope}
              onChange={(v) => {
                if (v === "selected" && selectedIds.size === 0) return;
                setExportScope(v as "current" | "selected");
              }}
              options={[
                { value: "current", label: `Todos los resultados (${total} calificaciones)`, description: "Incluye todas las páginas con los filtros y fechas actuales." },
                {
                  value: "selected",
                  label: `Seleccionados (${selectedIds.size} leads)`,
                  description: selectedIds.size === 0 ? "Marca leads en la tabla con la casilla de la izquierda para habilitar esta opción." : undefined,
                },
              ]}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Columnas</p>
              <button
                type="button"
                onClick={() => setExportColumns(
                  exportColumns.size === EXPORT_COLUMNS.length
                    ? new Set()
                    : new Set(EXPORT_COLUMNS.map((c) => c.key))
                )}
                className="text-xs text-accent hover:underline"
              >
                {exportColumns.size === EXPORT_COLUMNS.length ? "Ninguna" : "Todas"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {EXPORT_COLUMNS.map((c) => (
                <Checkbox
                  key={c.key}
                  id={`export-col-${c.key}`}
                  checked={exportColumns.has(c.key)}
                  onChange={() => toggleExportColumn(c.key)}
                  label={c.label}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
