"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Plus, Target, Trash2, Pencil, Sparkles, Clock, Download } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Pagination } from "@/app/components/ui/pagination";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Modal } from "@/app/components/ui/modal";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Checkbox } from "@/app/components/ui/checkbox";
import { RadioGroup } from "@/app/components/ui/radio";
import { useToast } from "@/app/components/ui/toast";
import { toCsv, downloadCsv } from "@/lib/csv";
import { EXPORT_COLUMNS, labelText, type LeadScoreRow } from "@/lib/whatsapp/export-columns";
import { LeadScorerFormModal } from "./_form";

interface LeadScorerBot {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number | null;
  updatedAt: string;
}

const PROVIDER_BADGE: Record<string, { label: string; tone: "accent" | "info" }> = {
  openrouter: { label: "OpenRouter", tone: "accent" },
  google: { label: "Gemini", tone: "info" },
};

const INTERVAL_LABEL: Record<number, string> = {
  15: "15 min",
  30: "30 min",
  60: "1 h",
  180: "3 h",
  360: "6 h",
  720: "12 h",
  1440: "24 h",
};

const LABEL_TONE: Record<string, "neutral" | "info" | "warning" | "accent" | "danger"> = {
  descartado: "neutral",
  frio: "info",
  interesado: "warning",
  oportunidad: "accent",
  prioridad_alta: "danger",
  // Legacy 3-tier labels, kept until every existing score gets re-run.
  tibio: "warning",
  caliente: "danger",
};

function labelTone(label: string) {
  return LABEL_TONE[label] ?? "neutral";
}

const LEADS_PAGE_SIZE = 25;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const TABS = ["calificadores", "leads"] as const;
type Tab = (typeof TABS)[number];

export default function CalificadoresPage() {
  const { data: session } = useSession();
  // El rol "user" solo puede ver leads ya calificados, no crear/editar/programar
  // calificadores — esa pestaña ni siquiera se ofrece como opción.
  const canManageScorers = session?.user?.role !== "user";
  const [tab, setTab] = useState<Tab>("calificadores");

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Calificadores de Leads"
        description="Crea agentes de IA que analizan una conversación y la califican con tu propio criterio — cada uno con su prompt libre, para el negocio que vendas."
      />

      {canManageScorers && (
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t === "calificadores" ? "Calificadores" : "Leads calificados"}
            </button>
          ))}
        </div>
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

  const columns: TableColumn<LeadScorerBot>[] = useMemo(() => [
    {
      key: "name",
      header: "Nombre",
      render: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span>,
    },
    {
      key: "provider",
      header: "Proveedor / Modelo",
      render: (r) => {
        const provider = PROVIDER_BADGE[r.provider] ?? { label: r.provider, tone: "info" as const };
        return (
          <div className="flex items-center gap-2">
            <Badge tone={provider.tone} size="sm">{provider.label}</Badge>
            <span className="text-xs text-muted-darker">{r.model}</span>
          </div>
        );
      },
    },
    {
      key: "prompt",
      header: "Prompt",
      render: (r) => <span className="text-sm text-muted-darker line-clamp-1">{r.systemPrompt}</span>,
    },
    {
      key: "schedule",
      header: "Automático",
      render: (r) =>
        r.scheduleEnabled && r.scheduleIntervalMinutes ? (
          <Badge tone="accent" size="sm" icon={Clock}>
            {INTERVAL_LABEL[r.scheduleIntervalMinutes] ?? `${r.scheduleIntervalMinutes} min`}
          </Badge>
        ) : (
          <span className="text-xs text-muted-darker">—</span>
        ),
    },
    {
      key: "isActive",
      header: "Activo",
      render: (r) => (
        <Switch
          checked={r.isActive}
          onCheckedChange={() => handleToggle(r)}
          disabled={togglingId === r.id}
        />
      ),
    },
  ], [togglingId, handleToggle]);

  return (
    <>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
          Crear calificador
        </Button>
      </div>

      <Card>
        <CardBody>
          <Table
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            loading={loading}
            error={fetchError}
            onRetry={fetchItems}
            emptyIcon={Target}
            emptyTitle="Sin calificadores"
            emptyDescription="Crea tu primer calificador para empezar a calificar leads desde los chats."
            mobileCard={(r) => {
              const provider = columns.find((c) => c.key === "provider")!;
              const schedule = columns.find((c) => c.key === "schedule")!;
              const active = columns.find((c) => c.key === "isActive")!;
              return (
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                    <div onClick={(e) => e.stopPropagation()}>{active.render(r)}</div>
                  </div>
                  {provider.render(r)}
                  {schedule.render(r)}
                </div>
              );
            }}
            rowActions={(r) => (
              <>
                <DropdownItem icon={Pencil} onClick={() => { setEditId(r.id); setModalOpen(true); }}>
                  Editar
                </DropdownItem>
                <DropdownItem icon={Trash2} onClick={() => setDeleteId(r.id)}>
                  Eliminar
                </DropdownItem>
              </>
            )}
          />
        </CardBody>
      </Card>

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
    </>
  );
}

function LeadsTab() {
  const { error: toastError } = useToast();
  const [rows, setRows] = useState<LeadScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
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

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/lead-scores");
      const data = await res.json();
      if (Array.isArray(data)) setRows(data);
      else throw new Error(data.error ?? "Error al cargar leads calificados");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar leads calificados");
      toastError(err instanceof Error ? err.message : "Error al cargar leads calificados");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    fetchRows();
  }, [fetchRows]);

  const scorers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.scorer.id, r.scorer.name);
    return Array.from(seen.entries());
  }, [rows]);

  const accounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.chat.account.id, r.chat.account.name);
    return Array.from(seen.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (scorerFilter !== "all" && r.scorer.id !== scorerFilter) return false;
      if (labelFilter !== "all" && r.label !== labelFilter) return false;
      if (accountFilter !== "all" && r.chat.account.id !== accountFilter) return false;
      const updatedDate = r.updatedAt.slice(0, 10);
      if (dateFrom && updatedDate < dateFrom) return false;
      if (dateTo && updatedDate > dateTo) return false;
      return true;
    });
  }, [rows, scorerFilter, labelFilter, accountFilter, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps pagination valid when filters narrow/widen the result set
  useEffect(() => { setPage(1); }, [scorerFilter, labelFilter, accountFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LEADS_PAGE_SIZE));
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * LEADS_PAGE_SIZE, page * LEADS_PAGE_SIZE),
    [filtered, page]
  );

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

  function handleExportCsv() {
    const exportRows = exportScope === "selected" ? filtered.filter((r) => selectedIds.has(r.id)) : filtered;
    const activeColumns = EXPORT_COLUMNS.filter((c) => exportColumns.has(c.key));
    const headers = activeColumns.map((c) => c.label);
    const csvRows = exportRows.map((r) => activeColumns.map((c) => c.get(r)));
    downloadCsv(`leads-calificados-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, csvRows));
    setExportModalOpen(false);
  }

  const columns: TableColumn<LeadScoreRow>[] = useMemo(() => [
    {
      key: "select",
      header: (
        <Checkbox checked={allFilteredSelected} onChange={toggleSelectAll} />
      ),
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
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
          {new Date(r.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={scorerFilter} onChange={(e) => setScorerFilter(e.target.value)}>
            <option value="all">Todos los calificadores</option>
            {scorers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
            <option value="all">Todas las calificaciones</option>
            <option value="prioridad_alta">Prioridad alta</option>
            <option value="oportunidad">Oportunidad</option>
            <option value="interesado">Interesado</option>
            <option value="frio">Frío</option>
            <option value="descartado">Descartado</option>
          </Select>
        </div>
        <div className="w-56">
          <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">Todas las cuentas</option>
            {accounts.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Desde" max={dateTo || undefined} />
        </div>
        <div className="w-36">
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="Hasta" min={dateFrom || undefined} />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          onClick={() => setExportModalOpen(true)}
          disabled={filtered.length === 0}
          className="ml-auto"
        >
          Exportar CSV
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <p className="text-xs text-muted-darker">{selectedIds.size} lead(s) seleccionado(s).</p>
      )}

      <Card>
        <CardBody>
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
                    <Checkbox checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
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
                      {new Date(r.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
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
        </CardBody>
      </Card>

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
                {new Date(detailRow.updatedAt).toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" })}
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
        onClose={() => setExportModalOpen(false)}
        title="Exportar CSV"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleExportCsv}
              disabled={exportColumns.size === 0 || (exportScope === "selected" && selectedIds.size === 0)}
            >
              Exportar
            </Button>
          </>
        }
      >
        <div className="space-y-5">
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
                { value: "current", label: `Vista actual (${filtered.length} leads)`, description: "Todo lo que cumple los filtros y el rango de fechas activos." },
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
