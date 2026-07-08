"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./cn";

interface PaginationProps {
  currentPage: number;
  totalPages:  number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ currentPage, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3)  pages.push("…");
    const from = Math.max(2, currentPage - 1);
    const to   = Math.min(totalPages - 1, currentPage + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:bg-surface-light hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={14} />
        <span className="hidden sm:inline">Anterior</span>
      </button>

      <div className="flex items-center gap-1">
        {pages.map((page, i) =>
          page === "…" ? (
            <span key={`dots-${i}`} className="px-2 py-2 text-sm text-muted-darker select-none">
              …
            </span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page as number)}
              className={cn(
                "min-w-[36px] px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                page === currentPage
                  ? "bg-accent text-on-accent font-bold"
                  : "border border-border text-muted hover:bg-surface-light hover:text-foreground"
              )}
            >
              {page}
            </button>
          )
        )}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:bg-surface-light hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <span className="hidden sm:inline">Siguiente</span>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
