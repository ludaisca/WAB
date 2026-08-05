import type { ReactNode } from "react";
import { cn } from "./cn";

// Promueve el helper `Row()` que vivía duplicado a mano en bots/[id]/page.tsx
// a primitivo compartido — misma anatomía (label eyebrow + valor alineado a
// la derecha, trunca en vez de envolver). Server-safe: `value` es ReactNode
// normal (badges, enlaces…), no un componente pasado como prop, así que no
// choca con la regla de RSC→Client.
export interface DefinitionRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function DefinitionRow({ label, value, mono }: DefinitionRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-darker">{label}</dt>
      <dd
        className={cn(
          "max-w-[60%] truncate text-right text-foreground",
          mono ? "font-mono text-xs" : "text-sm font-medium"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

interface DefinitionListProps {
  rows: DefinitionRowProps[];
  className?: string;
}

export function DefinitionList({ rows, className }: DefinitionListProps) {
  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {rows.map((row) => (
        <DefinitionRow key={row.label} {...row} />
      ))}
    </dl>
  );
}
