import React from "react";
import { cn } from "./cn";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

const SIZE: Record<Size, { box: string; icon: number }> = {
  sm: { box: "h-9  w-9  rounded-lg",  icon: 16 },
  md: { box: "h-11 w-11 rounded-xl",  icon: 20 },
  lg: { box: "h-14 w-14 rounded-xl",  icon: 24 },
  xl: { box: "h-16 w-16 rounded-2xl", icon: 28 },
};

const TONE: Record<Tone, string> = {
  accent:  "bg-accent/10 text-accent",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger:  "bg-danger-bg text-danger",
  info:    "bg-info-bg text-info",
  neutral: "bg-surface-light text-muted",
};

interface IconBoxProps {
  icon: React.ElementType;
  size?: Size;
  tone?: Tone;
  className?: string;
}

export function IconBox({ icon: Icon, size = "md", tone = "accent", className }: IconBoxProps) {
  const { box, icon: iconSize } = SIZE[size];
  return (
    <div className={cn("flex items-center justify-center shrink-0", box, TONE[tone], className)}>
      <Icon size={iconSize} />
    </div>
  );
}
