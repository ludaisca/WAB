"use client";

import { useCountUp } from "@/app/hooks/use-count-up";
import { cn } from "./cn";

interface AnimatedNumberProps {
  /** Valor numérico final. La animación va del valor previo → este. */
  value: number;
  /** Decimales a mostrar (default 0). */
  decimals?: number;
  /** Notación compacta (1.2K, 3.4M). Ignora `decimals` para el formato. */
  compact?: boolean;
  /** Texto fijo antes de la cifra, p. ej. "$". */
  prefix?: string;
  /** Texto fijo después de la cifra, p. ej. "%". */
  suffix?: string;
  /** Duración en segundos (default 0.9). */
  duration?: number;
  className?: string;
}

/**
 * Cifra animada con count-up (usa `useCountUp` → Motion spring, respeta
 * reduced-motion). Todas las props son serializables, así que un Server Component
 * (KpiStrip) puede renderizarla sin romper la regla "no pasar funciones a client".
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  compact = false,
  prefix = "",
  suffix = "",
  duration = 0.9,
  className,
}: AnimatedNumberProps) {
  const v = useCountUp(value, { decimals, duration });
  const formatted = compact
    ? v.toLocaleString("es-MX", { notation: "compact", maximumFractionDigits: 1 })
    : v.toLocaleString("es-MX", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
