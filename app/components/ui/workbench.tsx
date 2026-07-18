import { cn } from "./cn";

// Layout editorial de los overviews (sustituye a BentoGrid): una columna
// principal ancha (actividad, gráficas, tablas) y un aside angosto (acciones
// rápidas, presupuesto, salud). Server-safe. Colapsa a 1 columna bajo lg.

export function Workbench({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-10 lg:grid-cols-3", className)}>{children}</div>;
}

export function WorkbenchMain({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 space-y-10 lg:col-span-2", className)}>{children}</div>;
}

export function WorkbenchAside({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 space-y-10", className)}>{children}</div>;
}
