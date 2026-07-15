"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, X, Check } from "lucide-react";
import { cn } from "./cn";

interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value = [],
  onChange,
  placeholder = "Seleccionar...",
  error,
  disabled,
  id,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(value);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = useCallback(
    (val: string) => {
      const next = value.includes(val)
        ? value.filter((v) => v !== val)
        : [...value, val];
      onChange?.(next);
    },
    [value, onChange]
  );

  const remove = useCallback(
    (val: string) => {
      onChange?.(value.filter((v) => v !== val));
    },
    [value, onChange]
  );

  const selectedLabels = options
    .filter((o) => selectedSet.has(o.value))
    .map((o) => o.label);

  return (
    <div className={cn("relative", className)} ref={ref}>
      {/* A real <button> can't contain the nested per-tag remove <button>s below
          (invalid HTML — browsers reparent it out, causing a hydration mismatch),
          so this trigger is a div with the same button semantics/keyboard support. */}
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
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "w-full min-h-10 rounded-lg border bg-surface-light px-3 py-2 text-left text-sm transition-colors cursor-pointer",
          "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30",
          error ? "border-danger-border" : "border-border",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          {selectedLabels.length === 0 ? (
            <span className="text-muted-darker">{placeholder}</span>
          ) : (
            selectedLabels.map((label, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-md bg-accent/10 text-accent px-2 py-0.5 text-xs font-medium"
              >
                {label}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const val = options.find((o) => o.label === label)?.value;
                    if (val) remove(val);
                  }}
                  className="hover:text-accent-hover"
                >
                  <X size={12} />
                </button>
              </span>
            ))
          )}
          <ChevronDown
            size={14}
            className={cn(
              "ml-auto shrink-0 text-muted-darker transition-transform",
              open && "rotate-180"
            )}
          />
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

      {open && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-surface shadow-lg py-1 max-h-56 overflow-y-auto animate-fade-in">
          {options.map((opt) => {
            const isSelected = selectedSet.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors",
                  isSelected
                    ? "bg-accent/5 text-accent"
                    : "text-foreground hover:bg-surface-light"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected
                      ? "border-accent bg-accent text-on-accent"
                      : "border-border"
                  )}
                >
                  {isSelected && <Check size={11} />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
