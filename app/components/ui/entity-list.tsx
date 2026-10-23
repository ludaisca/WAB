"use client";

import React from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "./cn";
import { SkeletonRow } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ListErrorState } from "./list-error-state";
import { Dropdown } from "./dropdown";

// Lista densa de entidades (sustituye a TileGrid): mismas props y ciclo
// loading/error/empty, pero filas tipo database (Linear/Notion) en vez de
// tiles — más información por pantalla y lectura vertical. renderTile pasa a
// llamarse renderRow y desaparece `columns`. Las acciones por fila usan el
// mismo Dropdown+stopPropagation, ahora reveladas al hover/focus.

interface EntityListProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  renderRow: (row: T) => React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyIcon: React.ElementType;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  skeletonCount?: number;
  className?: string;
}

export function EntityList<T>({
  rows,
  rowKey,
  renderRow,
  loading,
  error,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  rowActions,
  skeletonCount = 8,
  className,
}: EntityListProps<T>) {
  if (error) {
    return <ListErrorState message={error} onRetry={onRetry ?? (() => {})} className={className} />;
  }

  if (loading) {
    return (
      <div className={cn("divide-y divide-border rounded-xl border border-border bg-surface px-4", className)}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <SkeletonRow key={i} cols={3} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface", className)}>
      {rows.map((row, i) => (
        <div
          key={rowKey(row)}
          tabIndex={onRowClick ? 0 : undefined}
          onKeyDown={onRowClick ? (e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(row); }
          } : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          // Entrada escalonada: cap a 8 filas para que las últimas no esperen de
          // más. React reutiliza el DOM por rowKey, así que al refiltrar solo
          // animan las filas nuevas, no las que persisten.
          style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          className={cn(
            "group relative flex items-center gap-3 px-4 py-3 transition-colors animate-fade-in-up",
            onRowClick && "cursor-pointer hover:bg-surface-light/60 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
          )}
        >
          {renderRow(row)}
          {rowActions && (
            <div
              // md:opacity-0 y no opacity-0 a secas: en touch no hay hover que
              // revele las acciones — en móvil quedan siempre visibles.
              className="shrink-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Dropdown
                align="right"
                trigger={
                  <button type="button" aria-label="Más acciones" className="min-h-10 min-w-10 inline-flex items-center justify-center rounded-md p-1.5 text-muted-darker transition-colors hover:bg-surface-light hover:text-foreground">
                    <MoreVertical size={15} />
                  </button>
                }
              >
                {rowActions(row)}
              </Dropdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Anatomía estándar de una fila: leading (normalmente <EntityAvatar>), bloque
// título/subtítulo, badges y meta a la derecha (cifras/fechas en font-mono la
// decide el caller). Puro layout — cada página decide el contenido.
interface EntityRowProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
}

export function EntityRow({ leading, title, subtitle, badges, meta }: EntityRowProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {badges}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-darker">{subtitle}</div>}
      </div>
      {meta && (
        <div className="flex w-full flex-wrap shrink-0 items-center gap-x-4 gap-y-1 text-xs text-muted sm:w-auto sm:text-right">
          {meta}
        </div>
      )}
    </div>
  );
}
