import Link from "next/link";
import { cn } from "./cn";
import { AnimatedNumber } from "./animated-number";

// Franja KPI del layout workbench — sustituye la fila de 4 StatCard con cajas.
// Una sola fila densa con divisores, sin bordes ni iconos: puramente
// tipográfica (cifra en font-mono, label eyebrow). Server-safe por diseño —
// al no aceptar iconos como props, los RSC (dashboard, hub WhatsApp) la usan
// directo sin chocar con la regla "no pasar componentes Lucide a client".

export interface KpiItem {
  label: string;
  /** Cifra ya formateada por el caller (es-MX, unidades, "1/1", "$0.42"…). */
  value: string;
  /** Alternativa a `value`: si se pasa, la cifra se anima con count-up. Las
   *  props de formato (decimals/compact/prefix/suffix) controlan la salida. */
  numeric?: number;
  numericDecimals?: number;
  numericCompact?: boolean;
  numericPrefix?: string;
  numericSuffix?: string;
  /** Variación o dato secundario junto al valor, p. ej. "+12%" o "3 sin leer". */
  delta?: string;
  deltaTone?: "success" | "danger" | "neutral";
  /** Texto pequeño bajo el label, p. ej. "conectadas". */
  hint?: string;
  href?: string;
}

const DELTA_TONE: Record<"success" | "danger" | "neutral", string> = {
  success: "text-success",
  danger: "text-danger",
  neutral: "text-muted-darker",
};

function KpiContent({ item, hero }: { item: KpiItem; hero: boolean }) {
  return (
    <>
      <p className="text-eyebrow font-medium uppercase tracking-wider text-muted-darker">
        {item.label}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "font-mono font-semibold tracking-tight text-foreground break-words",
            hero ? "text-3xl sm:text-hero" : "text-xl sm:text-2xl"
          )}
        >
          {item.numeric !== undefined ? (
            <AnimatedNumber
              value={item.numeric}
              decimals={item.numericDecimals}
              compact={item.numericCompact}
              prefix={item.numericPrefix}
              suffix={item.numericSuffix}
            />
          ) : (
            item.value
          )}
        </span>
        {item.delta && (
          <span className={cn("font-mono text-xs", DELTA_TONE[item.deltaTone ?? "neutral"])}>
            {item.delta}
          </span>
        )}
      </p>
      {item.hint && <p className="text-xs text-muted">{item.hint}</p>}
    </>
  );
}

interface KpiStripProps {
  items: KpiItem[];
  /** "hero" agranda las cifras (overviews); "compact" para contextos embebidos. */
  size?: "hero" | "compact";
  className?: string;
}

export function KpiStrip({ items, size = "hero", className }: KpiStripProps) {
  const hero = size === "hero";
  return (
    <div
      className={cn(
        // gap-y: sin esto, una fila que envuelve (flex-wrap) queda pegada a
        // la anterior — con min-w-32 como único piso, una celda con un valor
        // grande (p. ej. "28,224") a font-size hero podía quedar más angosta
        // que su propio contenido, que se desbordaba horizontalmente y se
        // montaba encima de la celda vecina en vez de hacer wrap dentro de
        // su caja (ver break-words en el <span> del valor, abajo).
        "flex flex-wrap gap-y-4 divide-border sm:divide-x",
        className
      )}
    >
      {items.map((item) => {
        const inner = <KpiContent item={item} hero={hero} />;
        const cellClass = cn(
          "flex min-w-32 flex-1 flex-col gap-1 py-1",
          "pr-6 sm:px-6 first:pl-0 sm:first:pl-0"
        );
        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className={cn(cellClass, "group rounded-md transition-colors hover:bg-surface/60")}
          >
            {inner}
          </Link>
        ) : (
          <div key={item.label} className={cellClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
