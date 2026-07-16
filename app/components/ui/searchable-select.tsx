"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "./cn";

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// Filtering only kicks in from 3 characters — below that a long option list
// (e.g. dozens of WhatsApp templates) would match almost everything anyway,
// so the full list stays visible and scrollable instead of flickering.
const MIN_SEARCH_LENGTH = 3;

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  error,
  disabled,
  id,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Índice resaltado para navegación con ↑/↓ + Enter — -1 = ninguno.
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const visibleOptions = useMemo(() => {
    if (query.trim().length < MIN_SEARCH_LENGTH) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Mueve el resaltado saltando opciones deshabilitadas, con wrap-around.
  function moveHighlight(delta: 1 | -1) {
    if (visibleOptions.length === 0) return;
    setHighlight((current) => {
      let i = current;
      for (let step = 0; step < visibleOptions.length; step++) {
        i = (i + delta + visibleOptions.length) % visibleOptions.length;
        if (!visibleOptions[i]?.disabled) return i;
      }
      return current;
    });
  }

  useEffect(() => {
    if (highlight < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function select(opt: SearchableSelectOption) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
    setHighlight(-1);
  }

  return (
    <div className={cn("relative", className)} ref={ref}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        id={id}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(!open || e.key === "ArrowDown");
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            setHighlight(-1);
          }
        }}
        className={cn(
          "w-full flex items-center gap-2 rounded-lg border bg-surface-light pl-3 sm:pl-4 pr-9 py-2 sm:py-2.5 text-sm text-left transition-colors cursor-pointer relative",
          "focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
          error ? "border-danger-border" : "border-border",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-darker")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "absolute right-3 top-1/2 -translate-y-1/2 text-muted-darker pointer-events-none transition-transform",
            open && "rotate-180"
          )}
        />
      </div>

      {error && (
        <p className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-surface shadow-lg animate-fade-in overflow-hidden">
          <div className="relative border-b border-border">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-darker" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(-1); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                  setQuery("");
                  setHighlight(-1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveHighlight(1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveHighlight(-1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const opt = visibleOptions[highlight];
                  if (opt) select(opt);
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-darker focus:outline-none"
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {visibleOptions.length === 0 ? (
              <p className="px-3.5 py-2.5 text-sm text-muted-darker">Sin resultados</p>
            ) : (
              visibleOptions.map((opt, i) => {
                const isSelected = opt.value === value;
                const isHighlighted = i === highlight;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    data-index={i}
                    disabled={opt.disabled}
                    onClick={() => select(opt)}
                    onMouseEnter={() => !opt.disabled && setHighlight(i)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors",
                      opt.disabled
                        ? "text-muted-darker cursor-not-allowed"
                        : isSelected
                          ? "bg-accent/5 text-accent"
                          : isHighlighted
                            ? "bg-surface-light text-foreground"
                            : "text-foreground hover:bg-surface-light"
                    )}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
