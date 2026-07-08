import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, number> = { sm: 14, md: 18, lg: 24 };

interface SpinnerProps {
  size?: Size;
  label?: string;
  className?: string;
}

export function Spinner({ size = "md", label = "Cargando…", className }: SpinnerProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-muted-darker", className)}>
      <Loader2 size={SIZE[size]} className="animate-spin" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
