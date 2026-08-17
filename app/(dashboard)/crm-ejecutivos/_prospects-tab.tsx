"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Handshake, ExternalLink } from "lucide-react";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Pagination } from "@/app/components/ui/pagination";
import { Badge } from "@/app/components/ui/badge";
import { Select } from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";
import { Modal } from "@/app/components/ui/modal";
import { formatDateTime } from "@/lib/timezone";
import { labelText, labelTone } from "@/lib/whatsapp/export-columns";

interface ExecutiveOption { id: string; label: string; }

interface AiScoreMatch {
  label: string;
  score: number;
  scorerName: string;
  updatedAt: string;
}

interface TrackingEntry {
  id: string;
  status: number;
  reason: string;
  observations: string;
  createdAt: string;
  action: string;
}

interface ProspectRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  product: string | null;
  campaign: string | null;
  observations: string | null;
  isOportunity: boolean;
  isClient: boolean;
  rejected: boolean;
  rejectedReason: string | null;
  discarted: boolean;
  discartedReason: string | null;
  lastTrackingReason: string | null;
  lastTrackingAt: string | null;
  salesCount: number | null;
  pipelineStatus: number | null;
  pipelinePhaseId: string | null;
  nextPendingAt: string | null;
  oportunityAt: string | null;
  clientAt: string | null;
  rejectedAt: string | null;
  reassignedAt: string | null;
  // Historial completo de seguimientos — solo presente para prospectos con
  // actividad real (ver comentario del campo `trackings` en schema.prisma).
  trackings: TrackingEntry[] | null;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  trackedExecutive: { id: string; label: string; phone: string };
  wab: { contactId: string; chatId: string | null; accountId: string } | null;
  aiScore: AiScoreMatch | null;
}

function AiScoreBadge({ aiScore }: { aiScore: AiScoreMatch | null }) {
  if (!aiScore) return <span className="text-xs text-muted-darker">Sin evaluar</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={labelTone(aiScore.label)} size="sm">{labelText(aiScore.label)}</Badge>
      <span className="text-[11px] font-mono text-muted-darker">{aiScore.score}</span>
    </span>
  );
}

// Historial completo de seguimientos — line de tiempo simple (sin componente
// de gráfica de por medio, es una lista cronológica de texto). `action` es
// el canal usado por el ejecutivo (Whatsapp/Llamada/Seguimiento Automatico).
function TrackingTimeline({ trackings }: { trackings: TrackingEntry[] }) {
  return (
    <div>
      <p className="text-xs text-muted-darker mb-2">Historial de seguimientos ({trackings.length})</p>
      <ol className="space-y-3 border-l border-border pl-4">
        {trackings.map((t) => (
          <li key={t.id} className="relative">
            <span className="absolute -left-[18px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" size="sm">{t.action || "Sin especificar"}</Badge>
              <span className="text-[11px] text-muted-darker">{formatDateTime(t.createdAt)}</span>
            </div>
            {(t.observations || t.reason) && (
              <p className="text-sm text-foreground mt-1">{t.observations || t.reason}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusBadge({ row }: { row: ProspectRow }) {
  if (row.isClient) return <Badge tone="success" size="sm">Cliente</Badge>;
  if (row.rejected) return <Badge tone="danger" size="sm">Rechazado</Badge>;
  if (row.discarted) return <Badge tone="neutral" size="sm">Descartado</Badge>;
  if (row.isOportunity) return <Badge tone="accent" size="sm">Oportunidad</Badge>;
  return <Badge tone="info" size="sm">Prospecto</Badge>;
}

export function ProspectsTab() {
  const [items, setItems] = useState<ProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [executives, setExecutives] = useState<ExecutiveOption[]>([]);
  const [executiveFilter, setExecutiveFilter] = useState("all");
  const [oportunityOnly, setOportunityOnly] = useState(false);
  // Activo por default — la vista útil del día a día es "los que ya son
  // míos en WAB", no el historial completo del CRM externo. El checkbox
  // sigue disponible para desmarcarlo y ver todo cuando haga falta.
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm-ejecutivos/tracked-executives")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setExecutives(d.map((e) => ({ id: e.id, label: e.label }))); })
      .catch(() => {});
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (executiveFilter !== "all") params.set("trackedExecutiveId", executiveFilter);
      if (oportunityOnly) params.set("isOportunity", "true");
      if (onlyMatched) params.set("onlyMatched", "true");
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/crm-ejecutivos/prospects?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar prospectos");
      setItems(data.items);
      setTotal(data.total);
      setPageSize(data.pageSize);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar prospectos");
    } finally {
      setLoading(false);
    }
  }, [page, executiveFilter, oportunityOnly, onlyMatched, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filtro-cambiado; fetchRows también se usa para refrescar manualmente
    fetchRows();
  }, [fetchRows]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- vuelve a página 1 cuando cambia un filtro, evita quedar en una página vacía
  useEffect(() => { setPage(1); }, [executiveFilter, oportunityOnly, onlyMatched, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const detailRow = items.find((r) => r.id === detailId) ?? null;

  const columns: TableColumn<ProspectRow>[] = [
    {
      key: "name",
      header: "Prospecto",
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "phone",
      header: "Teléfono",
      render: (r) => <span className="text-xs text-muted-darker">{r.phone}</span>,
    },
    {
      key: "product",
      header: "Producto",
      render: (r) => <span className="text-sm text-muted-darker">{r.product ?? "—"}</span>,
      hideBelow: "sm",
    },
    {
      key: "executive",
      header: "Ejecutivo",
      render: (r) => <span className="text-xs text-muted-darker">{r.trackedExecutive.label}</span>,
      hideBelow: "md",
    },
    {
      key: "status",
      header: "Estado",
      render: (r) => <StatusBadge row={r} />,
    },
    {
      key: "aiScore",
      header: "Predicción IA",
      render: (r) => <AiScoreBadge aiScore={r.aiScore} />,
      hideBelow: "md",
    },
    {
      key: "wab",
      header: "En WAB",
      render: (r) =>
        r.wab?.chatId ? (
          <Link
            href={`/whatsapp/chat/${r.wab.accountId}/${r.wab.chatId}`}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Ver chat <ExternalLink size={12} />
          </Link>
        ) : r.wab ? (
          <span className="text-xs text-muted-darker">Contacto sin chat</span>
        ) : (
          <span className="text-xs text-muted-darker">—</span>
        ),
      hideBelow: "sm",
    },
    {
      key: "sourceCreatedAt",
      header: "Creado",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (r) => <span className="text-xs text-muted-darker">{formatDateTime(r.sourceCreatedAt)}</span>,
      hideBelow: "md",
    },
  ];

  return (
    <>
      <Workbench>
        <WorkbenchMain>
          <SectionHeader eyebrow="CRM Ejecutivos" title="Prospectos" />
          <div className="mt-4">
            <Table
              columns={columns}
              rows={items}
              rowKey={(r) => r.id}
              loading={loading}
              error={fetchError}
              onRetry={fetchRows}
              onRowClick={(r) => setDetailId(r.id)}
              emptyIcon={Handshake}
              emptyTitle="Sin prospectos"
              emptyDescription={
                executives.length === 0
                  ? "Agrega un ejecutivo monitoreado en la otra pestaña para empezar a ver sus prospectos aquí."
                  : executiveFilter !== "all" || oportunityOnly || onlyMatched || search.trim()
                    ? "Ningún prospecto cumple los filtros activos — prueba a quitar alguno (\"Solo con match en WAB\" está activo por default)."
                    : "Agrega un ejecutivo monitoreado en la otra pestaña para empezar a ver sus prospectos aquí."
              }
            />
            {totalPages > 1 && (
              <div className="flex justify-center mt-4 pt-4 border-t border-border">
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </div>
        </WorkbenchMain>

        <WorkbenchAside>
          <SectionHeader eyebrow="Filtros" title="Refinar búsqueda" />
          <div className="mt-4 space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o producto..."
            />
            <Select value={executiveFilter} onChange={(e) => setExecutiveFilter(e.target.value)}>
              <option value="all">Todos los ejecutivos</option>
              {executives.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-darker">
              <input
                type="checkbox"
                checked={oportunityOnly}
                onChange={(e) => setOportunityOnly(e.target.checked)}
                className="accent-accent"
              />
              Solo oportunidades
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-darker">
              <input
                type="checkbox"
                checked={onlyMatched}
                onChange={(e) => setOnlyMatched(e.target.checked)}
                className="accent-accent"
              />
              Solo con match en WAB
            </label>
          </div>
        </WorkbenchAside>
      </Workbench>

      <Modal open={!!detailRow} onClose={() => setDetailId(null)} title={detailRow?.name} size="lg">
        {detailRow && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <StatusBadge row={detailRow} />
              <span className="text-xs text-muted-darker">
                {formatDateTime(detailRow.sourceUpdatedAt, { dateStyle: "long", timeStyle: "short" })}
              </span>
            </div>
            {(detailRow.clientAt || detailRow.oportunityAt || detailRow.rejectedAt) && (
              <p className="text-[11px] text-muted-darker -mt-2">
                {detailRow.isClient && detailRow.clientAt && `Cliente desde ${formatDateTime(detailRow.clientAt)}`}
                {!detailRow.isClient && detailRow.isOportunity && detailRow.oportunityAt && `Oportunidad desde ${formatDateTime(detailRow.oportunityAt)}`}
                {detailRow.rejected && detailRow.rejectedAt && `Rechazado el ${formatDateTime(detailRow.rejectedAt)}`}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-darker">Teléfono</dt>
                <dd>{detailRow.phone}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-darker">Ejecutivo</dt>
                <dd>{detailRow.trackedExecutive.label}</dd>
              </div>
              {detailRow.email && (
                <div>
                  <dt className="text-xs text-muted-darker">Email</dt>
                  <dd className="truncate">{detailRow.email}</dd>
                </div>
              )}
              {detailRow.product && (
                <div>
                  <dt className="text-xs text-muted-darker">Producto</dt>
                  <dd>{detailRow.product}</dd>
                </div>
              )}
              {!!detailRow.salesCount && (
                <div>
                  <dt className="text-xs text-muted-darker">Ventas registradas</dt>
                  <dd className="font-mono">{detailRow.salesCount}</dd>
                </div>
              )}
              {detailRow.nextPendingAt && (
                <div>
                  <dt className="text-xs text-muted-darker">Próximo seguimiento</dt>
                  <dd>{formatDateTime(detailRow.nextPendingAt)}</dd>
                </div>
              )}
              {detailRow.campaign && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-darker">Campaña</dt>
                  <dd>{detailRow.campaign}</dd>
                </div>
              )}
              {(detailRow.pipelineStatus !== null || detailRow.pipelinePhaseId) && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-darker">Estado interno del CRM externo</dt>
                  <dd className="text-xs text-muted-darker font-mono">
                    {detailRow.pipelineStatus !== null && `status: ${detailRow.pipelineStatus}`}
                    {detailRow.pipelineStatus !== null && detailRow.pipelinePhaseId && " · "}
                    {detailRow.pipelinePhaseId && `fase: ${detailRow.pipelinePhaseId}`}
                  </dd>
                </div>
              )}
            </dl>
            <div>
              <p className="text-xs text-muted-darker mb-1">Predicción de la IA (WAB)</p>
              {detailRow.aiScore ? (
                <div className="flex items-center gap-2">
                  <AiScoreBadge aiScore={detailRow.aiScore} />
                  <span className="text-[11px] text-muted-darker">
                    {detailRow.aiScore.scorerName} · {formatDateTime(detailRow.aiScore.updatedAt)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-darker">Sin evaluar aún — no hay un lead calificado para este chat en WAB.</p>
              )}
            </div>
            {detailRow.observations && (
              <div>
                <p className="text-xs text-muted-darker mb-1">Observaciones</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{detailRow.observations}</p>
              </div>
            )}
            {detailRow.trackings && detailRow.trackings.length > 0 ? (
              <TrackingTimeline trackings={detailRow.trackings} />
            ) : (
              detailRow.lastTrackingReason && (
                <div>
                  <p className="text-xs text-muted-darker mb-1">Último seguimiento</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{detailRow.lastTrackingReason}</p>
                  {detailRow.lastTrackingAt && (
                    <p className="text-[11px] text-muted-darker mt-1">{formatDateTime(detailRow.lastTrackingAt)}</p>
                  )}
                </div>
              )
            )}
            {detailRow.rejected && detailRow.rejectedReason && (
              <div>
                <p className="text-xs text-danger mb-1">Motivo de rechazo</p>
                <p className="text-sm text-foreground">{detailRow.rejectedReason}</p>
              </div>
            )}
            {detailRow.discarted && detailRow.discartedReason && (
              <div>
                <p className="text-xs text-muted-darker mb-1">Motivo de descarte</p>
                <p className="text-sm text-foreground">{detailRow.discartedReason}</p>
              </div>
            )}
            {detailRow.wab?.chatId && (
              <Link
                href={`/whatsapp/chat/${detailRow.wab.accountId}/${detailRow.wab.chatId}`}
                className="inline-flex text-sm text-accent hover:underline"
              >
                Ir al chat en WAB →
              </Link>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
