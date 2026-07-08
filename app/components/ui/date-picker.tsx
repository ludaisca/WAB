"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "./cn";

interface DatePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
}

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DAYS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parseDisplay(display: string): string | null {
  const match = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function DatePicker({
  value = "",
  onChange,
  placeholder = "DD/MM/AAAA",
  error,
  disabled,
  min,
  max,
  id,
  className,
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState(formatDate(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDisplay(formatDate(value));
  }

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const applyDate = useCallback(
    (y: number, m: number, d: number) => {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      setDisplay(formatDate(iso));
      onChange?.(iso);
      setOpen(false);
    },
    [onChange]
  );

  const handleInputBlur = () => {
    const parsed = parseDisplay(display);
    if (parsed) {
      onChange?.(parsed);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplay(e.target.value);
  };

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [];

  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayISO = today.toISOString().split("T")[0];
  const selectedISO = parseDisplay(display);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-darker pointer-events-none" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={display}
          onChange={handleInputChange}
          onFocus={() => !disabled && setOpen(true)}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          className={cn(
            "w-full h-10 rounded-lg border bg-surface-light px-4 pl-10 pr-8 text-sm text-foreground",
            "placeholder:text-muted-darker outline-none transition-colors",
            "focus:border-accent focus:ring-1 focus:ring-accent/30",
            error ? "border-danger-border" : "border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
        {display && !disabled && (
          <button
            type="button"
            onClick={() => { setDisplay(""); onChange?.(""); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-darker hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

      {open && (
        <div
          ref={panelRef}
          className={cn(
            "absolute z-50 mt-1.5 rounded-xl border border-border bg-surface shadow-lg p-3 w-[280px]",
            "animate-fade-in"
          )}
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
                else setViewMonth(viewMonth - 1);
              }}
              className="p-1 rounded-md hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-foreground">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
                else setViewMonth(viewMonth + 1);
              }}
              className="p-1 rounded-md hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-muted-darker py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />;
              const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday = iso === todayISO;
              const isSelected = iso === selectedISO;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyDate(viewYear, viewMonth, day)}
                  className={cn(
                    "h-8 w-full rounded-md text-xs font-medium transition-colors",
                    "hover:bg-surface-light",
                    isSelected && "bg-accent text-on-accent hover:bg-accent-hover",
                    isToday && !isSelected && "border border-accent text-accent",
                    !isSelected && !isToday && "text-foreground"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              applyDate(today.getFullYear(), today.getMonth(), today.getDate());
            }}
            className="mt-3 w-full text-xs text-accent hover:text-accent-hover transition-colors py-1.5 rounded-md hover:bg-surface-light"
          >
            Hoy
          </button>
        </div>
      )}
    </div>
  );
}
