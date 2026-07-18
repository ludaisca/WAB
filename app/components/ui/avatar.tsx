import { cn } from "./cn";
import { hueClassFor } from "./hue";

// Avatar de iniciales con hue determinista por entidad — server-safe (sin
// "use client", sin iconos como props), usable directo desde los RSC de
// overview y desde componentes client. La esquina de burbuja (rounded-bubble)
// es parte de la firma visual del rediseño.

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface EntityAvatarProps {
  /** Id estable de la entidad (normalmente accountId) — decide el hue. */
  id: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function EntityAvatar({ id, name, size = "md", className }: EntityAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-bubble bg-entity-bg font-semibold text-entity",
        SIZE[size],
        hueClassFor(id),
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
