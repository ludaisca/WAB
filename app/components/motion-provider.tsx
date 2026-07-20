"use client";

import { LazyMotion, domAnimation } from "motion/react";

/**
 * Carga solo el subconjunto `domAnimation` de Motion (~6KB en lugar de los ~34KB
 * del paquete completo) y activa `strict`, que obliga a usar los componentes
 * `m.*` (no `motion.*`) — así el bundle no crece por accidente. Envuelve el árbol
 * cliente para que cualquier animación con Motion comparta esta carga diferida.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
