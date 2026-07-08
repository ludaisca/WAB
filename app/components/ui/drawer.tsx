"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";

type DrawerSide = "left" | "right";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  title?: string;
  width?: string;
  className?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  side = "left",
  title,
  width = "w-72",
  className,
  children,
}: DrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = React.useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setVisible(true);
      triggerRef.current = document.activeElement;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length) focusable[0].focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    panel.addEventListener("keydown", trap);
    return () => panel.removeEventListener("keydown", trap);
  }, [open, visible]);

  useEffect(() => {
    if (!open && triggerRef.current) {
      (triggerRef.current as HTMLElement).focus?.();
    }
  }, [open]);

  const handleAnimationEnd = useCallback(() => {
    if (!open) setVisible(false);
  }, [open]);

  if (!mounted || !visible) return null;

  const slideIn  = side === "left" ? "animate-slide-in-left"  : "animate-slide-in-right";
  const slideOut = side === "left" ? "animate-slide-out-left" : "animate-slide-out-right";
  const position = side === "left" ? "left-0" : "right-0";

  return createPortal(
    <div className={cn("fixed inset-0 z-50", open ? "animate-fade-in" : "animate-fade-out")} onAnimationEnd={handleAnimationEnd}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "absolute top-0 bottom-0 bg-surface border-border flex flex-col shadow-lg",
          side === "left" ? "border-r" : "border-l",
          position,
          width,
          open ? slideIn : slideOut,
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="text-muted-darker hover:text-foreground transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
