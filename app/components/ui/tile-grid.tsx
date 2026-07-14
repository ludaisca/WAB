"use client";

import React from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "./cn";
import { BentoTile } from "./bento-grid";
import { SkeletonCard } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ListErrorState } from "./list-error-state";
import { Dropdown } from "./dropdown";

// Data-driven replacement for <Table> (table.tsx) on entity list pages —
// same loading/error/empty lifecycle and the same rowActions/onRowClick
// contract, but renders a responsive grid of tiles via a render-prop instead
// of table rows/columns. No `sort`/`onSortChange` equivalent: there are no
// clickable column headers on a tile grid — pages that need ordering expose an
// explicit toolbar <Select>, which they already have alongside their filters.

const COLS: Record<"2" | "3" | "4", string> = {
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

interface TileGridProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  renderTile: (row: T) => React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyIcon: React.ElementType;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  columns?: "2" | "3" | "4";
  skeletonCount?: number;
  className?: string;
}

export function TileGrid<T>({
  rows,
  rowKey,
  renderTile,
  loading,
  error,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  rowActions,
  columns = "3",
  skeletonCount = 6,
  className,
}: TileGridProps<T>) {
  if (error) {
    return <ListErrorState message={error} onRetry={onRetry ?? (() => {})} className={className} />;
  }

  if (loading) {
    return (
      <div className={cn("grid gap-4", COLS[columns], className)}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <SkeletonCard key={i} />
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
    <div className={cn("grid gap-4", COLS[columns], className)}>
      {rows.map((row) => (
        <BentoTile
          key={rowKey(row)}
          interactive={!!onRowClick}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className="relative"
        >
          {renderTile(row)}
          {rowActions && (
            <div className="absolute top-3 right-3" onClick={(e) => e.stopPropagation()}>
              <Dropdown
                align="right"
                trigger={
                  <button className="p-1 rounded-md hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors">
                    <MoreVertical size={14} />
                  </button>
                }
              >
                {rowActions(row)}
              </Dropdown>
            </div>
          )}
        </BentoTile>
      ))}
    </div>
  );
}
