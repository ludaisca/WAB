"use client";

import React from "react";
import { ChevronUp, ChevronDown, MoreVertical } from "lucide-react";
import { cn } from "./cn";
import { SkeletonRow } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ListErrorState } from "./list-error-state";
import { Dropdown } from "./dropdown";

export interface TableColumn<T> {
  key: string;
  header: React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  hideBelow?: "sm" | "md";
}

interface TableSort {
  key: string;
  direction: "asc" | "desc";
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyIcon: React.ElementType;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  sort?: TableSort;
  onSortChange?: (key: string) => void;
  mobileCard?: (row: T) => React.ReactNode;
  skeletonRows?: number;
  className?: string;
}

const HIDE_BELOW_CLASS: Record<"sm" | "md", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  rowActions,
  sort,
  onSortChange,
  mobileCard,
  skeletonRows = 5,
  className,
}: TableProps<T>) {
  if (error) {
    return <ListErrorState message={error} onRetry={onRetry ?? (() => {})} className={className} />;
  }

  if (loading) {
    return (
      <div className={cn("divide-y divide-border", className)}>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <SkeletonRow key={i} cols={columns.length} />
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
    <div className={className}>
      <div className="hidden sm:block overflow-x-auto -mx-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider first:pl-5",
                    col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
                    col.sortable && "cursor-pointer select-none hover:text-foreground",
                    col.headerClassName
                  )}
                  aria-sort={col.sortable ? (sort?.key === col.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                >
                  {col.sortable && onSortChange ? <button type="button" className="inline-flex min-h-9 items-center gap-1 text-left focus-visible:outline-2 focus-visible:outline-accent rounded-sm" onClick={() => onSortChange(col.key)}>
                    {col.header}
                    {col.sortable && sort?.key === col.key && (
                      sort.direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </button> : col.header}
                </th>
              ))}
              {rowActions && (
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase tracking-wider w-12" />
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                className={cn("animate-fade-in-up hover:bg-surface-light/40 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2", onRowClick && "cursor-pointer")}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(row); }
                } : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 first:pl-5",
                      col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
                      col.cellClassName
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      align="right"
                      trigger={
                        <button type="button" aria-label="Acciones de la fila" className="min-h-10 min-w-10 inline-flex items-center justify-center p-1 rounded-md hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors">
                          <MoreVertical size={14} />
                        </button>
                      }
                    >
                      {rowActions(row)}
                    </Dropdown>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sm:hidden divide-y divide-border -mx-4">
        {rows.map((row, i) => (
          <div
            key={rowKey(row)}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            className={cn(
              "animate-fade-in-up px-4 py-4 flex items-start justify-between gap-3 hover:bg-surface-light/20 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2",
              onRowClick && "cursor-pointer"
            )}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(row); }
            } : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <div className="min-w-0 flex-1">
              {mobileCard ? mobileCard(row) : <DefaultMobileCard row={row} columns={columns} />}
            </div>
            {rowActions && (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Dropdown
                  align="right"
                  trigger={
                    <button type="button" aria-label="Acciones de la fila" className="min-h-10 min-w-10 inline-flex items-center justify-center p-1.5 rounded-md border border-border bg-surface hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors">
                      <MoreVertical size={14} />
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
    </div>
  );
}

function DefaultMobileCard<T>({ row, columns }: { row: T; columns: TableColumn<T>[] }) {
  const [first, ...rest] = columns;
  if (!first) return null;
  const renderFields = (fields: TableColumn<T>[]) => fields.map((col) => (
    <div key={col.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-sm">
      <div className="text-muted text-xs pt-0.5">{col.header}</div>
      <div className="min-w-0 break-words">{col.render(row)}</div>
    </div>
  ));
  return (
    <div className="space-y-3">
      <div className="font-medium text-sm">{first.render(row)}</div>
      {renderFields(rest.slice(0, 2))}
      {rest.length > 2 && (
        <details onClick={(e) => e.stopPropagation()} className="group/mobile">
          <summary className="cursor-pointer py-2 text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent">Más detalles ({rest.length - 2})</summary>
          <div className="space-y-3 border-t border-border pt-3">{renderFields(rest.slice(2))}</div>
        </details>
      )}
    </div>
  );
}
