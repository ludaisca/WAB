"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";

type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  persistent?: boolean;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  persistent = false,
  footer,
  className,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  const handleClose = useCallback(() => {
    if (persistent) return;
    onClose();
  }, [persistent, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

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
      if (e.key !== "Tab") return;
      if (!focusable.length) { e.preventDefault(); return; }
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

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        open ? "animate-fade-in" : "animate-fade-out"
      )}
      onAnimationEnd={handleAnimationEnd}
    >
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? `${titleId}-desc` : undefined}
        className={cn(
          "relative w-full rounded-2xl border border-border bg-surface shadow-lg",
          "flex flex-col max-h-[90vh]",
          open ? "animate-scale-in" : "animate-scale-out",
          SIZE[size],
          className
        )}
      >
        {(title || !persistent) && (
          <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-border shrink-0">
            <div>
              {title && (
                <h2 id={titleId} className="text-base font-semibold text-foreground">
                  {title}
                </h2>
              )}
              {description && (
                <p id={`${titleId}-desc`} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            {!persistent && (
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="text-muted-darker hover:text-foreground transition-colors shrink-0 mt-0.5"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className="overflow-y-auto px-6 py-4 flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
