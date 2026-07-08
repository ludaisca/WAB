import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, placeholder, className, children, ...props }, ref) => {
    return (
      <div className={cn("relative", className)}>
        <select
          ref={ref}
          aria-invalid={!!error}
          className={cn(
            "w-full appearance-none rounded-lg border bg-surface-light pl-3 sm:pl-4 pr-9 py-2 sm:py-2.5 text-sm text-foreground",
            "transition-colors",
            "focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
            error ? "border-danger-border" : "border-border"
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {children}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-darker pointer-events-none"
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
Select.displayName = "Select";
