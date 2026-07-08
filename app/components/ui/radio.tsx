"use client";

import React from "react";
import { cn } from "./cn";

interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name: string;
  disabled?: boolean;
  className?: string;
  error?: string;
}

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  disabled,
  className,
  error,
}: RadioGroupProps) {
  return (
    <div className={cn("space-y-3", className)} role="radiogroup">
      {options.map((opt) => {
        const isChecked = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              "flex items-start gap-3 cursor-pointer group",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <div className="relative mt-0.5">
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={isChecked}
                onChange={() => onChange?.(opt.value)}
                disabled={disabled}
                className={cn(
                  "peer h-4 w-4 shrink-0 rounded-full border border-border bg-surface-light",
                  "checked:border-accent checked:bg-surface-light",
                  "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-1 focus:ring-offset-background",
                  "appearance-none cursor-pointer transition-colors"
                )}
              />
              {isChecked && (
                <div className="pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full bg-accent" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-sm text-foreground select-none">{opt.label}</span>
              {opt.description && (
                <p className="text-xs text-muted-darker mt-0.5">{opt.description}</p>
              )}
            </div>
          </label>
        );
      })}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
