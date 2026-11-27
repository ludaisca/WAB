"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { cn } from "@/app/components/ui/cn";

// Avance de una campaña calculado del estado real de cada destinatario (no de
// los contadores de WACampaign, que solo se recalculan al terminar). Muestra
// una barra segmentada (leídos / entregados / enviados / fallidos /
// pendientes), si la campaña está formada detrás de otra en la cola, y una
// estimación del tiempo restante a partir del ritmo observado entre sondeos.

export interface LiveCounts {
  PENDING?: number;
  SENT?: number;
  DELIVERED?: number;
  READ?: number;
  FAILED?: number;
}

interface Props {
  status: string;
  sendState: "waiting" | "active" | null;
  counts: LiveCounts;
  total: number;
}

const SEGMENTS = [
  { key: "READ", label: "Leídos", className: "bg-success" },
  { key: "DELIVERED", label: "Entregados", className: "bg-success/60" },
  { key: "SENT", label: "Enviados", className: "bg-info" },
  { key: "FAILED", label: "Fallidos", className: "bg-danger" },
] as const;

function formatEta(seconds: number): string {
  if (seconds < 60) return "menos de 1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function CampaignProgress({ status, sendState, counts, total }: Props) {
  const pending = counts.PENDING ?? 0;
  const processed = Math.max(0, total - pending);
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const sending = status === "SENDING";
  const queued = sending && sendState === "waiting";
  const active = sending && !queued;

  // Ritmo: primera observación con el job activo vs la actual. Se reinicia si
  // la campaña deja de enviarse (p. ej. termina y luego se reintenta).
  const startRef = useRef<{ processed: number; at: number } | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  useEffect(() => {
    if (!active || pending === 0) {
      startRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from polled props
      setEta(null);
      return;
    }
    const now = Date.now();
    if (!startRef.current) {
      startRef.current = { processed, at: now };
      return;
    }
    const done = processed - startRef.current.processed;
    const elapsed = (now - startRef.current.at) / 1000;
    if (done > 0 && elapsed > 5) setEta(formatEta((pending * elapsed) / done));
  }, [active, pending, processed]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          {queued ? (
            <Clock size={15} className="text-warning shrink-0 animate-pulse" />
          ) : active ? (
            <Loader2 size={15} className="text-accent shrink-0 animate-spin" />
          ) : null}
          <span className="font-medium truncate">
            {queued
              ? "En fila: esperando a que termine otra campaña"
              : active
                ? "Enviando…"
                : status === "DRAFT" || status === "SCHEDULED"
                  ? "Sin enviar"
                  : "Envío terminado"}
          </span>
        </div>
        <span className="font-mono tabular-nums text-muted-darker shrink-0">
          {processed.toLocaleString("es-MX")} / {total.toLocaleString("es-MX")} · {percent}%
        </span>
      </div>

      <div
        className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={processed}
        aria-label="Avance del envío"
      >
        {SEGMENTS.map((s) => {
          const n = counts[s.key] ?? 0;
          if (n === 0 || total === 0) return null;
          return (
            <div
              key={s.key}
              className={cn("h-full transition-[width] duration-700 ease-out", s.className)}
              style={{ width: `${(n / total) * 100}%` }}
            />
          );
        })}
        {/* Brillo que recorre la parte procesada mientras se envía; en fila
            pulsa la parte pendiente para que se note que está esperando. */}
        {active && processed > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-white/40 to-transparent bg-[length:200%_100%] animate-shimmer transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          />
        )}
        {queued && <div className="absolute inset-0 animate-pulse bg-warning/15" />}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-darker">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-2 rounded-full", s.className)} />
            {s.label} <span className="font-mono tabular-nums text-foreground">{(counts[s.key] ?? 0).toLocaleString("es-MX")}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-border" />
          Pendientes <span className="font-mono tabular-nums text-foreground">{pending.toLocaleString("es-MX")}</span>
        </span>
        {active && eta && <span className="ml-auto font-mono">≈ {eta} restantes</span>}
      </div>
    </div>
  );
}
