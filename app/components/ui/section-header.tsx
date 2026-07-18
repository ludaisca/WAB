import { cn } from "./cn";

// Encabezado de sección del layout workbench — sustituye a los cards con borde
// como separador visual: la jerarquía la da la tipografía (eyebrow uppercase +
// título en Fraunces), no una caja. Server-safe, sin iconos como props.

interface SectionHeaderProps {
  title: string;
  /** Etiqueta pequeña uppercase sobre el título, p. ej. "Actividad". */
  eyebrow?: string;
  /** Acción a la derecha (link "Ver todo", botón) — ReactNode, no icono suelto. */
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, eyebrow, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-eyebrow font-medium uppercase tracking-wider text-muted-darker">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {action && <div className="shrink-0 pb-0.5">{action}</div>}
    </div>
  );
}
