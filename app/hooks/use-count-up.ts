"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

interface UseCountUpOptions {
  /** Duración de la animación en segundos (default 0.9). */
  duration?: number;
  /** Decimales a conservar en el valor devuelto (default 0 → entero). */
  decimals?: number;
}

/**
 * Anima un número desde el valor previo hasta `target` (0 en el primer montaje).
 * Respeta `prefers-reduced-motion`: salta directo al valor final sin animar.
 * Devuelve un número — el formateo (separadores, moneda, %) lo hace el consumidor.
 * Pensado para las cifras protagonistas de `KpiStrip`.
 */
export function useCountUp(
  target: number,
  { duration = 0.9, decimals = 0 }: UseCountUpOptions = {}
): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    // Camino único: cuando hay reduced-motion, `duration: 0` hace que `animate`
    // salte directo al valor (el setState ocurre dentro de onUpdate, un callback,
    // nunca de forma síncrona en el cuerpo del efecto).
    const controls = animate(prev.current, target, {
      duration: reduce ? 0 : duration,
      ease: [0.16, 1, 0.3, 1], // ease-out-expo, coherente con --ease-out-expo
      onUpdate: (v) => setValue(v),
    });
    prev.current = target;
    return () => controls.stop();
  }, [target, duration, reduce]);

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
