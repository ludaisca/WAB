"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dropdown({
  trigger,
  children,
  align = "left",
  className,
  open: controlledOpen,
  onOpenChange,
}: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        className="cursor-pointer"
      >
        {trigger}
      </div>
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 mt-1.5 min-w-[180px] rounded-xl border border-border bg-surface shadow-lg py-1 animate-fade-in",
            align === "right" ? "right-0" : "left-0"
          )}
          onClick={close}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ElementType;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DropdownItem({
  children,
  onClick,
  icon: Icon,
  danger,
  disabled,
  className,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors",
        danger
          ? "text-danger hover:bg-danger-bg"
          : "text-foreground hover:bg-surface-light",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {Icon && <Icon size={15} className={danger ? "text-danger" : "text-muted-darker"} />}
      {children}
    </button>
  );
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-border" />;
}

interface DropdownButtonProps {
  label: string;
  icon?: React.ElementType;
  variant?: "default" | "outline";
  size?: "sm" | "md";
  chevron?: boolean;
  className?: string;
}

export function DropdownButton({
  label,
  icon: Icon,
  variant = "outline",
  size = "md",
  chevron = true,
  className,
}: DropdownButtonProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg transition-colors select-none",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
        variant === "outline"
          ? "border border-border hover:bg-surface-light text-foreground"
          : "bg-surface-light hover:bg-surface text-foreground",
        className
      )}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} className="text-muted-darker" />}
      <span className="font-medium">{label}</span>
      {chevron && <ChevronDown size={size === "sm" ? 12 : 14} className="text-muted-darker" />}
    </div>
  );
}
