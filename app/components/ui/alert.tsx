"use client";

import React from "react";
import { CheckCircle, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "./cn";

type AlertTone = "success" | "warning" | "danger" | "info";

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  icon?: React.ElementType;
}

const TONE_STYLES: Record<AlertTone, { bg: string; border: string; text: string; icon: React.ElementType }> = {
  success: { bg: "bg-success-bg", border: "border-success-border", text: "text-success", icon: CheckCircle },
  warning: { bg: "bg-warning-bg", border: "border-warning-border", text: "text-warning", icon: AlertTriangle },
  danger:  { bg: "bg-danger-bg",  border: "border-danger-border",  text: "text-danger",  icon: XCircle },
  info:    { bg: "bg-info-bg",    border: "border-info-border",    text: "text-info",    icon: Info },
};

export function Alert({ tone = "info", title, children, onClose, className, icon }: AlertProps) {
  const style = TONE_STYLES[tone];
  const Icon = icon ?? style.icon;

  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        style.bg,
        style.border,
        className
      )}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", style.text)} />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold text-foreground mb-0.5">{title}</p>}
        <p className="text-foreground/80">{children}</p>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="shrink-0 text-muted-darker hover:text-foreground transition-colors mt-0.5"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
