import React from "react";
import { Card } from "./card";
import { cn } from "./cn";

// Layout primitives for "overview" pages (Panel, hub de WhatsApp, Estadísticas):
// a curated, mostly-static grid of tiles with hand-picked spans, as opposed to
// TileGrid (tile-grid.tsx) which renders a data-driven list with its own
// loading/error/empty lifecycle. Deliberately no "use client" — usable directly
// from Server Components.

export type BentoColSpan = 1 | 2 | 3 | 4;
export type BentoRowSpan = 1 | 2;

export interface BentoTileSpan {
  base?: BentoColSpan;
  sm?: BentoColSpan;
  lg?: BentoColSpan;
}

// Tailwind v4 here has no tailwind.config/safelist — only literal class strings
// in source are picked up by the JIT scanner. These Record lookups (same pattern
// as icon-box.tsx's SIZE/TONE) keep every class as static text even though the
// span value is chosen at runtime. Never interpolate `col-span-${n}` directly.
const COL_SPAN_BASE: Record<BentoColSpan, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
};
const COL_SPAN_SM: Record<BentoColSpan, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
};
const COL_SPAN_LG: Record<BentoColSpan, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};
const ROW_SPAN: Record<BentoRowSpan, string> = {
  1: "row-span-1",
  2: "row-span-2",
};

interface BentoGridProps {
  className?: string;
  children: React.ReactNode;
}

export function BentoGrid({ className, children }: BentoGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[minmax(11rem,auto)]",
        className
      )}
    >
      {children}
    </div>
  );
}

interface BentoTileProps {
  span?: BentoTileSpan;
  rowSpan?: BentoRowSpan;
  padding?: "none" | "sm" | "md" | "lg";
  interactive?: boolean;
  as?: React.ElementType;
  className?: string;
  children: React.ReactNode;
  [key: string]: unknown;
}

export function BentoTile({ span, rowSpan = 1, className, children, ...rest }: BentoTileProps) {
  const resolved = { base: 1 as BentoColSpan, sm: 1 as BentoColSpan, lg: 1 as BentoColSpan, ...span };
  return (
    <Card
      className={cn(
        COL_SPAN_BASE[resolved.base],
        COL_SPAN_SM[resolved.sm],
        COL_SPAN_LG[resolved.lg],
        ROW_SPAN[rowSpan],
        "flex flex-col",
        className
      )}
      {...rest}
    >
      {children}
    </Card>
  );
}
