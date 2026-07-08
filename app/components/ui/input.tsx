import React from "react";
import { cn } from "./cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ElementType;
  error?: string;
  inputClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ icon: Icon, error, className, inputClassName, ...props }, ref) => {
    return (
      <div className={cn("relative", className)}>
        {Icon && (
          <Icon
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-darker pointer-events-none"
          />
        )}
        <input
          ref={ref}
          aria-invalid={!!error}
          className={cn(
            "w-full rounded-lg border bg-surface-light py-2.5 text-sm text-foreground",
            "transition-colors placeholder:text-muted-darker",
            "focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
            Icon ? "pl-9 pr-4" : "px-4",
            error
              ? "border-danger-border focus:border-danger"
              : "border-border",
            inputClassName
          )}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
