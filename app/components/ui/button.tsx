"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:   "bg-accent text-on-accent font-semibold hover:bg-accent-hover disabled:opacity-60",
  secondary: "border border-border text-foreground bg-transparent hover:bg-surface-light disabled:opacity-60",
  ghost:     "text-muted hover:bg-surface-light hover:text-foreground disabled:opacity-60",
  danger:    "bg-danger-bg text-danger border border-danger-border hover:bg-danger/20 disabled:opacity-60",
  link:      "text-accent hover:underline underline-offset-4 p-0 h-auto disabled:opacity-60",
};

const SIZE: Record<Size, string> = {
  sm: "h-8  px-3   text-xs  gap-1.5",
  md: "h-10 px-4   text-sm  gap-2",
  lg: "h-11 px-6   text-sm  gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ElementType;
  iconRight?: React.ElementType;
  fullWidth?: boolean;
  href?: string;
  external?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon: Icon,
      iconRight: IconRight,
      fullWidth = false,
      href,
      external = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const base = cn(
      "inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer select-none",
      "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
      variant !== "link" && SIZE[size],
      VARIANT[variant],
      fullWidth && "w-full",
      (disabled || loading) && "pointer-events-none",
      className
    );

    const content = (
      <>
        {loading
          ? <Loader2 size={16} className="animate-spin shrink-0" />
          : Icon && <Icon size={16} className="shrink-0" />}
        {children}
        {!loading && IconRight && <IconRight size={16} className="shrink-0" />}
      </>
    );

    if (href && !disabled && !loading) {
      const {
        type: _type,
        form: _form,
        disabled: _disabled,
        loading: _loading,
        icon: _icon,
        iconRight: _iconRight,
        fullWidth: _fullWidth,
        href: _href,
        external: _external,
        variant: _variant,
        size: _size,
        ...linkProps
      } = props as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const safe = linkProps as any;
      if (external) {
        return (
          <a href={href as string} className={base} target="_blank" rel="noopener noreferrer" {...safe}>
            {content}
          </a>
        );
      }
      return (
        <Link href={href as string} className={base} {...safe}>
          {content}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={base}
        {...props}
      >
        {content}
      </button>
    );
  }
);

Button.displayName = "Button";
