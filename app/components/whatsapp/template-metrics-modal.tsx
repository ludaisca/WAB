"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "next-themes";
import { CalendarRange } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { Banner } from "@/app/components/ui/banner";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Button } from "@/app/components/ui/button";
import { KpiStrip } from "@/app/components/ui/kpi-strip";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";
import { useHasMounted } from "@/app/hooks/use-has-mounted";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PENDING: { label: "Pendiente", tone: "warning" },
  APPROVED: { label: "Aprobada", tone: "success" },
  REJECTED: { label: "Rechazada", tone: "danger" },
  PAUSED: { label: "Pausada", tone: "neutral" },
  DISABLED: { label: "Deshabilitada", tone: "neutral" },
};

// Validated categorical slots 1-4 (blue/green/magenta/yellow) from the dataviz palette —
// checked with scripts/validate_palette.js against this app's actual chart surfaces
// (#f0f3ef light, #1a2420 dark): all pass. Not app semantic tokens (accent/success/etc.)
// because those are reserved for status meaning, not series identity.
const SERIES = [
  { key: "sent", label: "Enviados", light: "#2a78d6", dark: "#3987e5" },
  { key: "delivered", label: "Entregados", light: "#008300", dark: "#008300" },
  { key: "read", label: "Leídos", light: "#e87ba4", dark: "#d55181" },
  { key: "clicked", label: "Clics", light: "#eda100", dark: "#c98500" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

interface TemplateDetail {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  waAccount: { id: string; name: string };
}

interface AnalyticsPoint {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
}

interface AnalyticsTotals {
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

// Meta's data_points are UTC day boundaries — format in UTC too, or a browser/server
// in a negative offset (e.g. Mexico, UTC-6) renders every point's date one day early
// (a UTC midnight boundary falls on the previous local calendar day).
function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function AnalyticsChart({ points }: { points: AnalyticsPoint[] }) {
  const { theme } = useTheme();
  const mounted = useHasMounted();
  const isDark = mounted && theme === "dark";
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const width = 640;
  const height = 240;
  const padding = { top: 12, right: 12, bottom: 24, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxRaw = Math.max(1, ...points.flatMap((p) => [p.sent, p.delivered, p.read, p.clicked]));
  const maxY = niceCeil(maxRaw);

  const xFor = useCallback(
    (i: number) => padding.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
    [points.length, innerW, padding.left]
  );
  const yFor = useCallback((v: number) => padding.top + innerH - (v / maxY) * innerH, [innerH, maxY, padding.top]);

  const pathFor = (key: SeriesKey) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p[key])}`).join(" ");

  const yTicks = [0, maxY / 2, maxY];

  // Show at most ~6 x-axis labels regardless of range length, so a 90-day window
  // doesn't collide into unreadable overlapping dates.
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!containerRef.current || points.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const plotFrac = (fracX * width - padding.left) / innerW;
    const idx = Math.round(plotFrac * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverXPercent = hoverIndex !== null ? (xFor(hoverIndex) / width) * 100 : 0;

  if (points.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-muted-darker">
        Sin datos en este rango de fechas.
      </div>
    );
  }

  return (
    <div>
      {/* Legend — line-key swatches, dependable identity channel for 4 series */}
      <div className="flex flex-wrap gap-4 mb-3">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: isDark ? s.dark : s.light }} />
            {s.label}
          </div>
        ))}
      </div>

      <div
        ref={containerRef}
        className="relative"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56" preserveAspectRatio="none" role="img" aria-label="Métricas diarias de la plantilla">
          {/* gridlines — hairline, recessive */}
          {yTicks.map((t) => (
            <line
              key={t}
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {yTicks.map((t) => (
            <text key={`label-${t}`} x={padding.left - 6} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted-darker)">
              {Math.round(t)}
            </text>
          ))}
          {points.map((p, i) =>
            i % labelStep === 0 ? (
              <text key={p.date} x={xFor(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--muted-darker)">
                {formatDayLabel(p.date)}
              </text>
            ) : null
          )}

          {/* crosshair */}
          {hoverIndex !== null && (
            <line
              x1={xFor(hoverIndex)}
              x2={xFor(hoverIndex)}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="var(--border)"
              strokeWidth={1}
            />
          )}

          {SERIES.map((s) => (
            <path key={s.key} d={pathFor(s.key)} fill="none" stroke={isDark ? s.dark : s.light} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {/* end-dots with direct labels — endpoint only, not every point */}
          {SERIES.map((s) => {
            const last = points[points.length - 1];
            return (
              <g key={`end-${s.key}`}>
                <circle cx={xFor(points.length - 1)} cy={yFor(last[s.key])} r={4} fill={isDark ? s.dark : s.light} stroke="var(--surface)" strokeWidth={2} />
              </g>
            );
          })}

          {/* hover markers on every series at the hovered x */}
          {hoverIndex !== null &&
            SERIES.map((s) => (
              <circle
                key={`hover-${s.key}`}
                cx={xFor(hoverIndex)}
                cy={yFor(hovered![s.key])}
                r={4}
                fill={isDark ? s.dark : s.light}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
        </svg>

        {hovered && hoverIndex !== null && (
          <div
            className="absolute top-2 -translate-x-1/2 bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none z-10 min-w-[140px]"
            style={{ left: `${Math.min(92, Math.max(8, hoverXPercent))}%` }}
          >
            <p className="font-medium text-foreground mb-1.5">{formatDayLabel(hovered.date)}</p>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ backgroundColor: isDark ? s.dark : s.light }} />
                  {s.label}
                </span>
                <span className="font-semibold text-foreground tabular-nums">{hovered[s.key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TemplateMetricsModal({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const { error: toastError } = useToast();

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [points, setPoints] = useState<AnalyticsPoint[]>([]);
  const [totals, setTotals] = useState<AnalyticsTotals>({ sent: 0, delivered: 0, read: 0, clicked: 0 });
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(29));
  const [dateTo, setDateTo] = useState(() => isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const loadTemplate = useCallback(async (id: string) => {
    setTemplate(null);
    setPoints([]);
    setDateFrom(isoDaysAgo(29));
    setDateTo(isoDaysAgo(0));
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${id}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setTemplate(d);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cargar la plantilla");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // Reset to a fresh 30-day window and re-fetch whenever a different template opens —
  // this component stays mounted (Modal needs `open` to toggle for its exit animation,
  // see LeadsTab's detail modal for the same pattern), so state doesn't reset on its own.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open; resets state for a newly opened template
    if (templateId) loadTemplate(templateId);
  }, [templateId, loadTemplate]);

  const fetchAnalytics = useCallback(async () => {
    if (!templateId) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await fetch(`/api/whatsapp/templates/${templateId}/analytics?start=${dateFrom}&end=${dateTo}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al obtener métricas");
      setPoints(data.points);
      setTotals(data.totals);
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : "Error al obtener métricas");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [templateId, dateFrom, dateTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open/date-change; fetchAnalytics also used for manual refresh
    if (templateId) fetchAnalytics();
  }, [templateId, dateFrom, dateTo, fetchAnalytics]);

  function applyPreset(days: number) {
    setDateTo(isoDaysAgo(0));
    setDateFrom(isoDaysAgo(days - 1));
  }

  const tableColumns: TableColumn<AnalyticsPoint>[] = useMemo(() => [
    { key: "date", header: "Fecha", render: (p) => <span className="text-xs">{formatDayLabel(p.date)}</span> },
    { key: "sent", header: "Enviados", render: (p) => <span className="text-xs tabular-nums">{p.sent}</span> },
    { key: "delivered", header: "Entregados", render: (p) => <span className="text-xs tabular-nums">{p.delivered}</span> },
    { key: "read", header: "Leídos", render: (p) => <span className="text-xs tabular-nums">{p.read}</span> },
    { key: "clicked", header: "Clics", render: (p) => <span className="text-xs tabular-nums">{p.clicked}</span> },
  ], []);

  const statusBadge = template ? (STATUS_BADGE[template.status] ?? { label: template.status, tone: "neutral" as const }) : null;

  return (
    <Modal
      open={!!templateId}
      onClose={onClose}
      size="xl"
      title={template?.name}
      description={template ? `${template.waAccount.name} · ${template.language} · ${template.category}` : undefined}
    >
      {loading || !template ? (
        <div className="flex items-center justify-center py-16"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          {statusBadge && (
            <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
          )}

          {/* Filters — one row, date range first, presets before custom range */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => applyPreset(7)}>7 días</Button>
              <Button variant="secondary" size="sm" onClick={() => applyPreset(30)}>30 días</Button>
              <Button variant="secondary" size="sm" onClick={() => applyPreset(90)}>90 días</Button>
            </div>
            <div className="w-36">
              <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Desde" max={dateTo} />
            </div>
            <div className="w-36">
              <DatePicker value={dateTo} onChange={setDateTo} placeholder="Hasta" min={dateFrom} max={isoDaysAgo(0)} />
            </div>
          </div>

          {analyticsError && (
            <Banner tone="danger" title="No se pudieron obtener las métricas de Meta">
              {analyticsError}
            </Banner>
          )}

          <KpiStrip
            size="compact"
            items={[
              { label: "Enviados", value: String(totals.sent) },
              { label: "Entregados", value: String(totals.delivered), hint: `${pct(totals.delivered, totals.sent)} de enviados` },
              { label: "Leídos", value: String(totals.read), hint: `${pct(totals.read, totals.delivered)} de entregados` },
              { label: "Clics", value: String(totals.clicked), hint: `${pct(totals.clicked, totals.read)} de leídos` },
            ]}
          />

          <Card>
            <CardHeader>
              <CardTitle>Evolución diaria</CardTitle>
            </CardHeader>
            <CardBody>
              {analyticsLoading ? (
                <div className="h-56 flex items-center justify-center"><Spinner /></div>
              ) : (
                <AnalyticsChart points={points} />
              )}
            </CardBody>
          </Card>

          {points.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Detalle por día</CardTitle>
              </CardHeader>
              <CardBody>
                <Table
                  columns={tableColumns}
                  rows={points}
                  rowKey={(p) => p.date}
                  emptyIcon={CalendarRange}
                  emptyTitle="Sin datos"
                  mobileCard={(p) => (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 w-full">
                      <span className="text-sm font-medium col-span-2">{formatDayLabel(p.date)}</span>
                      <span className="text-xs text-muted-darker">Enviados: <span className="tabular-nums text-foreground">{p.sent}</span></span>
                      <span className="text-xs text-muted-darker">Entregados: <span className="tabular-nums text-foreground">{p.delivered}</span></span>
                      <span className="text-xs text-muted-darker">Leídos: <span className="tabular-nums text-foreground">{p.read}</span></span>
                      <span className="text-xs text-muted-darker">Clics: <span className="tabular-nums text-foreground">{p.clicked}</span></span>
                    </div>
                  )}
                />
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}
