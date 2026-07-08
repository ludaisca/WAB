import React from "react";
import { IconBox } from "./icon-box";
import { cn } from "./cn";

type Tone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  tone?: Tone;
  sublabel?: string;
  className?: string;
}

export function StatCard({ label, value, icon, tone = "accent", sublabel, className }: StatCardProps) {
  return (
    <div className={cn(
      "rounded-xl border border-border bg-surface p-5 flex flex-col gap-4",
      className
    )}>
      <div className="flex items-start justify-between">
        <IconBox icon={icon} size="md" tone={tone} />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="text-sm text-muted mt-0.5">{label}</p>
        {sublabel && (
          <p className="text-xs text-muted-darker mt-1">{sublabel}</p>
        )}
      </div>
    </div>
  );
}
