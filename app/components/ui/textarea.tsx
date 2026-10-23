import React from "react";
import { cn } from "./cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  autoGrow?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, autoGrow, className, ...props }, ref) => {
    return (
      <div className={cn("relative", className)}>
        <textarea
          ref={ref}
          aria-invalid={!!error}
          className={cn(
            "w-full rounded-lg border bg-surface-light px-4 py-2.5 text-sm text-foreground",
            "transition-colors placeholder:text-muted-darker",
            autoGrow ? "resize-none min-h-11 max-h-48 overflow-y-auto field-sizing-content" : "resize-y min-h-[80px]",
            "focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
            error ? "border-danger-border" : "border-border"
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
Textarea.displayName = "Textarea";
