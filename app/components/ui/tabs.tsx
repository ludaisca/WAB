"use client";

import { useRef } from "react";
import { cn } from "./cn";

// Un solo archivo para las dos pieles de tab que el app necesita — misma API
// controlada, roving tabindex y navegación con flechas compartidas — en vez
// de un 4to primitivo tipo-select separado. `Tabs` (subrayado) reemplaza las
// 3 barras `border-b-2` copiadas a mano (calificadores/campañas/bots[id]);
// `SegmentedControl` (píldora en pista) es para elecciones cortas y mutuamente
// excluyentes que no son "secciones de página" (estado del chat, triage del
// inbox). Deliberadamente sin prop de ícono — los items solo llevan
// label/count (string/number), así un Server Component puede construir la
// lista de items sin chocar con la regla de "no pasar componentes a Client
// Components".
export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

interface TabsBaseProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
}

function useRovingTabs(items: TabItem[], onChange: (value: string) => void) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;

    e.preventDefault();
    const next = items[nextIndex];
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  }

  return { refs, handleKeyDown };
}

export function Tabs({ items, value, onChange, className, ...aria }: TabsBaseProps) {
  const { refs, handleKeyDown } = useRovingTabs(items, onChange);
  return (
    <div role="tablist" aria-label={aria["aria-label"]} className={cn("flex items-center gap-1 border-b border-border", className)}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
            }}
            role="tab"
            type="button"
            id={`tab-${item.value}`}
            aria-selected={active}
            aria-controls={`tabpanel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn("ml-1.5 font-mono text-xs", active ? "text-accent" : "text-muted-darker")}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl({ items, value, onChange, className, ...aria }: TabsBaseProps) {
  const { refs, handleKeyDown } = useRovingTabs(items, onChange);
  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-surface-light p-1", className)}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) refs.current.set(item.value, el);
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-surface text-foreground shadow-xs" : "text-muted hover:text-foreground"
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ml-1.5 font-mono text-[11px] text-muted-darker">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
