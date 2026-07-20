"use client";

import { useId } from "react";
import { useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "./cn";

// Capa temática sobre Recharts. Los colores salen de las variables CSS
// --chart-1..4 (paleta categórica validada, ver globals.css), así que responden
// solas al toggle claro/oscuro sin duplicar hexes aquí. Ejes/grid usan los tokens
// semánticos para quedar recesivos.
//
// Regla de la paleta: las series se asignan en orden fijo y NO se ciclan — más de
// 4 categorías se pliegan en "Otros" (gris neutro), nunca se generan hues nuevos.

const SERIES_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
] as const;

export const MAX_SERIES = SERIES_VARS.length;

export function chartColor(index: number): string {
  return SERIES_VARS[index] ?? "var(--muted-darker)";
}

function formatNumber(n: number): string {
  return n.toLocaleString("es-MX");
}

/* ─────────────────────────────────────────────
   Tooltip compartido — HTML con tokens, no el default de Recharts
   ───────────────────────────────────────────── */

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueSuffix?: string;
}

function ChartTooltipContent({ active, payload, label, valueSuffix }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      {label !== undefined && (
        <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <p key={entry.dataKey ?? i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
              aria-hidden="true"
            />
            <span className="text-muted">{entry.name}</span>
            <span className="ml-3 font-mono text-foreground">
              {typeof entry.value === "number" ? formatNumber(entry.value) : entry.value}
              {valueSuffix}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function ChartEmpty({ height, message = "Sin datos aún" }: { height: number; message?: string }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-darker"
      style={{ height }}
    >
      {message}
    </div>
  );
}

/* ─────────────────────────────────────────────
   TrendChart — serie temporal (área con línea de 2px)
   ───────────────────────────────────────────── */

export interface TrendSeries {
  key: string;
  name: string;
}

interface TrendChartProps {
  /** Cada punto necesita `label` (eje X) + una clave por serie. */
  data: Array<Record<string, string | number>>;
  /** Máximo 4 series (regla de la paleta categórica). */
  series: TrendSeries[];
  height?: number;
  valueSuffix?: string;
  className?: string;
}

export function TrendChart({
  data,
  series,
  height = 240,
  valueSuffix,
  className,
}: TrendChartProps) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const visible = series.slice(0, MAX_SERIES);

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <div className={className}>
      {/* Leyenda propia (HTML, tokens): identidad nunca por color solo — además
          da el "relief" que exige el WARN de contraste en tema claro. */}
      {visible.length >= 2 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {visible.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ background: chartColor(i) }}
                aria-hidden="true"
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            <defs>
              {visible.map((s, i) => (
                <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor(i)} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={chartColor(i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted-darker)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: "var(--muted-darker)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={46}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltipContent valueSuffix={valueSuffix} />}
              cursor={{ stroke: "var(--muted-darker)", strokeDasharray: "3 3" }}
            />
            {visible.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={chartColor(i)}
                strokeWidth={2}
                fill={`url(#${uid}-${s.key})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={!reduce}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   DonutChart — distribución, con total al centro y leyenda con valores
   ───────────────────────────────────────────── */

export interface DonutSlice {
  name: string;
  value: number;
  /** Color explícito (para escalas con significado, p. ej. frío/tibio/caliente). */
  color?: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  height?: number;
  /** Etiqueta bajo el total del centro. */
  totalLabel?: string;
  /**
   * Plegar las categorías sobrantes en "Otros" (default true). La regla de las 4
   * ranuras aplica a paletas categóricas de *identidad*; ponlo en false cuando cada
   * porción sea un **estado** con color propio con significado (p. ej. calificación
   * de lead), donde plegar borraría una categoría real.
   */
  fold?: boolean;
  className?: string;
}

export function DonutChart({
  data,
  height = 200,
  totalLabel,
  fold = true,
  className,
}: DonutChartProps) {
  const reduce = useReducedMotion();

  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const slices: DonutSlice[] =
    fold && sorted.length > MAX_SERIES
      ? [
          ...sorted.slice(0, MAX_SERIES - 1),
          {
            name: "Otros",
            value: sorted.slice(MAX_SERIES - 1).reduce((sum, s) => sum + s.value, 0),
            color: "var(--muted-darker)",
          },
        ]
      : sorted;

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <ChartEmpty height={height} />;

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0" style={{ height, width: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="82%"
              // paddingAngle + borde del color de superficie = separación de 2px
              // entre segmentos (los deja legibles sin depender del color).
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={!reduce}
            >
              {slices.map((s, i) => (
                <Cell key={s.name} fill={s.color ?? chartColor(i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold text-foreground">
            {formatNumber(total)}
          </span>
          {totalLabel && <span className="text-xs text-muted-darker">{totalLabel}</span>}
        </div>
      </div>

      {/* Etiquetas directas: nombre + valor + % por categoría. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color ?? chartColor(i) }}
              aria-hidden="true"
            />
            <span className="truncate text-muted">{s.name}</span>
            <span className="ml-auto shrink-0 font-mono text-foreground">
              {formatNumber(s.value)}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-darker">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────
   FunnelBars — embudo (enviados → entregados → leídos)
   ───────────────────────────────────────────── */

export interface FunnelStep {
  name: string;
  value: number;
}

/**
 * Embudo como barras decrecientes proporcionales al primer paso. Sin Recharts:
 * es más legible que un <Funnel> y reutiliza el lenguaje de barras de progreso
 * que ya usa la app. Cada paso lleva su valor y su % — etiquetas directas.
 */
export function FunnelBars({ steps, className }: { steps: FunnelStep[]; className?: string }) {
  const base = steps[0]?.value ?? 0;
  if (base === 0) return <ChartEmpty height={120} />;

  return (
    <div className={cn("space-y-3", className)}>
      {steps.map((step, i) => {
        const pct = (step.value / base) * 100;
        return (
          <div key={step.name}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted">{step.name}</span>
              <span className="font-mono text-foreground">
                {formatNumber(step.value)}
                <span className="ml-1.5 text-muted-darker">{Math.round(pct)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-light">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%`, background: chartColor(i) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
