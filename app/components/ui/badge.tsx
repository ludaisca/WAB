import React from "react";
import { cn } from "./cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";
type Size = "sm" | "md";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-light text-muted border border-border",
  success: "bg-success-bg text-success border border-success-border",
  warning: "bg-warning-bg text-warning border border-warning-border",
  danger:  "bg-danger-bg  text-danger  border border-danger-border",
  info:    "bg-info-bg    text-info    border border-info-border",
  accent:  "bg-accent/10  text-accent  border border-accent/30",
};

const SIZE: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
};

interface BadgeProps {
  tone?: Tone;
  size?: Size;
  icon?: React.ElementType;
  /** Punto pulsante antes del texto — para estados "vivos" (Activo, Enviando…). */
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Badge({ tone = "neutral", size = "md", icon: Icon, pulse, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        TONE[tone],
        SIZE[size],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {Icon && <Icon size={12} className="shrink-0" />}
      {children}
    </span>
  );
}
