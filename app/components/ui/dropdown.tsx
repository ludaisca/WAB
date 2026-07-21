"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { useHasMounted } from "@/app/hooks/use-has-mounted";

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
  const mounted = useHasMounted();
  const [internalOpen, setInternalOpen] = useState(false);
  const [render, setRender] = useState(controlledOpen ?? false);
  // Coordenadas en viewport (position: fixed), no relativas al trigger — el
  // menú se porta a document.body para escapar de cualquier ancestro con
  // overflow-hidden/overflow-x-auto. Un menú position:absolute anidado ahí
  // queda recortado porque, al ser absoluto, no aporta a la altura intrínseca
  // del contenedor: EntityList (overflow-hidden para las esquinas redondeadas)
  // y Table (overflow-x-auto para el scroll horizontal, que por la regla de
  // acoplamiento de CSS también fuerza overflow-y a "auto") lo cortan a la
  // mitad en listas cortas — confirmado en vivo en /configuracion/exportaciones
  // y /whatsapp/cuentas.
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // Montar el menú de inmediato al abrir; se desmonta cuando termina la animación
  // de salida (onAnimationEnd). setState durante el render es el patrón oficial de
  // React para derivar estado de props previas — no va en un efecto.
  if (isOpen && !render) setRender(true);

  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

  // Recalcula la posición del menú antes del paint (evita el parpadeo en la
  // posición vieja) y la mantiene al hacer scroll/resize mientras está abierto.
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    function updatePosition() {
      const rect = anchorRef.current!.getBoundingClientRect();
      setPosition(
        align === "right"
          ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 6, left: rect.left }
      );
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, align]);

  useEffect(() => {
    if (!isOpen) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      // El trigger sigue en su lugar (no se porta); solo el menú vive en
      // document.body — hay que revisar ambos para "click afuera".
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
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
    <div
      ref={anchorRef}
      data-state={isOpen ? "open" : "closed"}
      className={cn("group/dd relative inline-block", className)}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        className="cursor-pointer"
      >
        {trigger}
      </div>
      {render && position && mounted && createPortal(
        <div
          ref={menuRef}
          style={{ top: position.top, left: position.left, right: position.right }}
          className={cn(
            "fixed z-50 min-w-[180px] rounded-xl border border-border bg-surface shadow-lg py-1",
            // El origen ancla el scale al trigger para que el menú "emerja" desde él.
            align === "right" ? "origin-top-right" : "origin-top-left",
            isOpen ? "animate-scale-in-spring" : "animate-scale-out"
          )}
          onClick={close}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && !isOpen) setRender(false);
          }}
        >
          {children}
        </div>,
        document.body
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
      {chevron && (
        <ChevronDown
          size={size === "sm" ? 12 : 14}
          className="text-muted-darker transition-transform duration-200 group-data-[state=open]/dd:rotate-180"
        />
      )}
    </div>
  );
}
