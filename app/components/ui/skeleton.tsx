import type { CSSProperties } from "react";
import { cn } from "./cn";

const SHIMMER =
  "bg-surface-light bg-[length:200%_100%] bg-gradient-to-r from-surface-light via-border to-surface-light animate-[shimmer_1.5s_linear_infinite]";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("rounded-md", SHIMMER, className)} style={style} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 && lines > 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)} aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4 flex-1", i === 0 && "max-w-[120px]")} />
      ))}
    </div>
  );
}

/** Franja KPI fantasma — misma anatomía que <KpiStrip> (label eyebrow + cifra). */
export function SkeletonKpi({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn("flex flex-wrap divide-border sm:divide-x", className)}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-32 flex-1 flex-col gap-2 py-1 pr-6 sm:px-6 first:pl-0 sm:first:pl-0"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Tarjeta fantasma — título + líneas de cuerpo dentro del borde de Card. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-surface p-5", className)}
      aria-hidden="true"
    >
      <Skeleton className="mb-4 h-5 w-40" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** Gráfica fantasma — área de trazado con eje inferior, para <SkeletonChart>. */
export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-surface p-5", className)}
      aria-hidden="true"
    >
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="flex h-40 items-end gap-2">
        {[60, 85, 45, 70, 95, 55, 75, 40, 88, 62].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Lista de chats fantasma — filas avatar + dos líneas (para el inbox). */
export function SkeletonChatList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-1", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-10 w-10 rounded-bubble shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Página de detalle fantasma — back-link + cabecera + card(s), para reemplazar
 *  el <Spinner/> desnudo que hace "pop" del layout completo. */
export function SkeletonDetail({ cards = 2, className }: { cards?: number; className?: string }) {
  return (
    <div className={cn("space-y-6", className)} aria-hidden="true">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-bubble" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 4 : 2} />
      ))}
    </div>
  );
}
