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
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={cn(
            "group relative flex items-center gap-3 px-4 py-3 transition-colors",
            onRowClick && "cursor-pointer hover:bg-surface-light/60"
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
                  <button className="rounded-md p-1.5 text-muted-darker transition-colors hover:bg-surface-light hover:text-foreground">
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
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {badges}
        </div>
        {subtitle && <div className="truncate text-xs text-muted-darker">{subtitle}</div>}
      </div>
      {meta && (
        <div className="hidden shrink-0 items-center gap-4 text-right text-xs text-muted sm:flex">
          {meta}
        </div>
      )}
    </div>
  );
}
