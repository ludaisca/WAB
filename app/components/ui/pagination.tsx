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
    <nav aria-label="Paginación" className={cn("flex items-center gap-2", className)}>
      <button
        type="button" aria-label="Página anterior"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:bg-surface-light hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={14} />
        <span className="hidden sm:inline">Anterior</span>
      </button>

      <span className="sm:hidden font-mono text-xs text-muted px-2" aria-live="polite">{currentPage} / {totalPages}</span>
      <div className="hidden sm:flex items-center gap-1">
        {pages.map((page, i) =>
          page === "…" ? (
            <span key={`dots-${i}`} className="px-2 py-2 text-sm text-muted-darker select-none">
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              aria-label={`Página ${page}`}
              aria-current={page === currentPage ? "page" : undefined}
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
        type="button" aria-label="Página siguiente"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:bg-surface-light hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <span className="hidden sm:inline">Siguiente</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
