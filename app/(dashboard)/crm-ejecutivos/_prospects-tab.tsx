"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Handshake, ExternalLink } from "lucide-react";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Pagination } from "@/app/components/ui/pagination";
import { Badge } from "@/app/components/ui/badge";
import { Select } from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Modal } from "@/app/components/ui/modal";
import { formatDateTime } from "@/lib/timezone";
import { labelText, labelTone } from "@/lib/whatsapp/export-columns";
import { AI_LABELS, aiLabelText } from "@/lib/crm-ejecutivos/ai-labels";
import { detectForeignSigner } from "@/lib/crm-ejecutivos/tracking-signer";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "prospecto", label: "Prospecto" },
  { value: "oportunidad", label: "Oportunidad" },
  { value: "cliente", label: "Cliente" },
  { value: "rechazado", label: "Rechazado" },
  { value: "descartado", label: "Descartado" },
];

const AI_LABEL_OPTIONS = [
  { value: "all", label: "Todas las predicciones" },
  ...AI_LABELS.map((l) => ({ value: l, label: aiLabelText(l) })),
  { value: "otro", label: aiLabelText("otro") },
  { value: "sin_evaluacion", label: aiLabelText("sin_evaluacion") },
];

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
  wab: WabMatch | null;
  aiScore: AiScoreMatch | null;
}

interface WabMatchEntry {
  contactId: string;
  chatId: string | null;
  accountId: string;
  accountName: string;
  lastMessageAt: string | null;
}

// `all` incluye a `primary` — cuando el teléfono aparece en más de una
// cuenta de WhatsApp (nada raro en un negocio multi-cuenta), `all.length`
// será mayor a 1 y la UI lo muestra en vez de esconder la ambigüedad detrás
// de una sola elección (ver el comentario en lib/crm-ejecutivos/match-contacts.ts).
interface WabMatch {
  primary: WabMatchEntry;
  all: WabMatchEntry[];
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
//
// "Otro agente": Limenka no expone autoría por seguimiento (ver el
// comentario en lib/crm-ejecutivos/tracking-signer.ts) — se marca cuando el
// texto trae una autopresentación ("Soy el/la...") que no coincide con el
// ejecutivo asignado. Confirmado poco frecuente (2 de 146 leads auditados,
// 2026-09) y siempre por firma detectada, nunca por ausencia de firma.
function TrackingTimeline({ trackings, executiveLabel }: { trackings: TrackingEntry[]; executiveLabel: string }) {
  const foreignCount = trackings.filter((t) => detectForeignSigner(t.observations, executiveLabel)).length;
  return (
    <div>
      <p className="text-xs text-muted-darker mb-2">
        Historial de seguimientos ({trackings.length})
        {foreignCount > 0 && ` — ${foreignCount} de otro agente`}
      </p>
      <ol className="space-y-3 border-l border-border pl-4">
        {trackings.map((t) => {
          const foreignSigner = detectForeignSigner(t.observations, executiveLabel);
          return (
            <li key={t.id} className="relative">
              <span className="absolute -left-[18px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm">{t.action || "Sin especificar"}</Badge>
                <span className="text-[11px] text-muted-darker">{formatDateTime(t.createdAt)}</span>
                {foreignSigner && (
                  <Badge tone="warning" size="sm">Otro agente: {foreignSigner}</Badge>
                )}
              </div>
              {(t.observations || t.reason) && (
                <p className="text-sm text-foreground mt-1">{t.observations || t.reason}</p>
              )}
            </li>
          );
        })}
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [aiLabelFilter, setAiLabelFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Activo por default — la vista útil del día a día es "los que ya son
  // míos en WAB", no el historial completo del CRM externo. El checkbox
  // sigue disponible para desmarcarlo y ver todo cuando haga falta.
  const [onlyMatched, setOnlyMatched] = useState(true);
  // También activo por default (Luis, 2026-09) — "sin evaluación IA" son
  // leads que el ejecutivo trabaja por otro canal y nunca generaron
  // conversación/calificación en WAB (asignación legítima, pero ruido para
  // este módulo). Lo que importa aquí es trazar la ruta de los que SÍ se
  // calificaron dentro de WAB.
  const [excludeUnevaluated, setExcludeUnevaluated] = useState(true);
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
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (aiLabelFilter !== "all") params.set("aiLabel", aiLabelFilter);
      if (onlyMatched) params.set("onlyMatched", "true");
      if (excludeUnevaluated) params.set("excludeUnevaluated", "true");
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

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
  }, [page, executiveFilter, statusFilter, aiLabelFilter, onlyMatched, excludeUnevaluated, search, dateFrom, dateTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filtro-cambiado; fetchRows también se usa para refrescar manualmente
    fetchRows();
  }, [fetchRows]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- vuelve a página 1 cuando cambia un filtro, evita quedar en una página vacía
  useEffect(() => { setPage(1); }, [executiveFilter, statusFilter, aiLabelFilter, onlyMatched, excludeUnevaluated, search, dateFrom, dateTo]);

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
      render: (r) => {
        if (!r.wab) return <span className="text-xs text-muted-darker">—</span>;
        const extra = r.wab.all.length - 1;
        return (
          <span className="inline-flex items-center gap-1.5">
            {r.wab.primary.chatId ? (
              <Link
                href={`/whatsapp/chat/${r.wab.primary.accountId}/${r.wab.primary.chatId}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Ver chat <ExternalLink size={12} />
              </Link>
            ) : (
              <span className="text-xs text-muted-darker">Contacto sin chat</span>
            )}
            {/* Mismo teléfono con Contact en más de una cuenta — abre el
                detalle en vez de ocultarlo, ahí se listan todas. */}
            {extra > 0 && (
              <Badge tone="warning" size="sm">
                +{extra} cuenta{extra === 1 ? "" : "s"}
              </Badge>
            )}
          </span>
        );
      },
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

  const filtersActive = executiveFilter !== "all" || statusFilter !== "all" || aiLabelFilter !== "all" || onlyMatched || excludeUnevaluated || !!search.trim() || !!dateFrom || !!dateTo;

  return (
    <>
      <div className="space-y-4">
        <SectionHeader eyebrow="CRM Ejecutivos" title="Prospectos" />

        <div className="flex flex-wrap items-center gap-3">
          <Input
            icon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o producto..."
            className="w-full sm:flex-1 sm:min-w-[220px]"
          />
          <Select value={executiveFilter} onChange={(e) => setExecutiveFilter(e.target.value)} className="w-full sm:w-auto sm:min-w-[170px]">
            <option value="all">Todos los ejecutivos</option>
            {executives.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-auto sm:min-w-[150px]">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          <Select value={aiLabelFilter} onChange={(e) => setAiLabelFilter(e.target.value)} className="w-full sm:w-auto sm:min-w-[190px]">
            {AI_LABEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          <div className="flex gap-2 w-full sm:w-auto">
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Creado desde" max={dateTo || undefined} />
            <DatePicker value={dateTo} onChange={setDateTo} placeholder="Creado hasta" min={dateFrom || undefined} />
          </div>
          <Checkbox checked={onlyMatched} onChange={setOnlyMatched} label="Solo con match en WAB" className="sm:ml-auto" />
          <Checkbox
            checked={excludeUnevaluated}
            onChange={setExcludeUnevaluated}
            label="Excluir sin evaluar por IA"
          />
        </div>

        <div>
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
                : filtersActive
                  ? "Ningún prospecto cumple los filtros activos — prueba a quitar alguno (\"Solo con match en WAB\" y \"Excluir sin evaluar por IA\" están activos por default)."
                  : "Agrega un ejecutivo monitoreado en la otra pestaña para empezar a ver sus prospectos aquí."
            }
          />
          {totalPages > 1 && (
            <div className="flex justify-center mt-4 pt-4 border-t border-border">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>

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
              <p className="text-xs text-muted-darker mb-1">
                Predicción de la IA (WAB)
                {detailRow.wab && detailRow.wab.all.length > 1 && (
                  <span className="ml-1 text-muted-darker">
                    — según {detailRow.wab.primary.accountName} (actividad más reciente entre {detailRow.wab.all.length} cuentas)
                  </span>
                )}
              </p>
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
              <TrackingTimeline trackings={detailRow.trackings} executiveLabel={detailRow.trackedExecutive.label} />
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
            {detailRow.wab && (
              <div>
                <p className="text-xs text-muted-darker mb-1">
                  {detailRow.wab.all.length > 1
                    ? `Este teléfono aparece en ${detailRow.wab.all.length} cuentas de WAB`
                    : "En WAB"}
                </p>
                <ul className="space-y-1.5">
                  {detailRow.wab.all.map((m) => (
                    <li key={m.contactId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5">
                        <Badge tone="neutral" size="sm">{m.accountName}</Badge>
                        {detailRow.wab!.all.length > 1 && m.contactId === detailRow.wab!.primary.contactId && (
                          <span className="text-[11px] text-muted-darker">más reciente</span>
                        )}
                      </span>
                      {m.chatId ? (
                        <Link
                          href={`/whatsapp/chat/${m.accountId}/${m.chatId}`}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          Ver chat <ExternalLink size={12} />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-darker">Contacto sin chat</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
