"use client";

import { ChevronDown, Wrench } from "lucide-react";
import { cn } from "./cn";

export interface AgentMessageBubbleProps {
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[] | null;
}

function ToolResultsSummary({ content }: { content: string }) {
  let parsed: { name: string; result: unknown; isError?: boolean }[] = [];
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  return (
    <details className="group max-w-[85%] rounded-lg border border-border bg-surface-light px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-xs text-muted select-none">
        <Wrench size={12} className="shrink-0" />
        <span className="flex-1">
          {parsed.map((p) => p.name).join(", ")}
        </span>
        <ChevronDown size={12} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-2">
        {parsed.map((p, i) => (
          <div key={i} className="space-y-0.5">
            <p className={cn("font-mono text-[11px]", p.isError ? "text-danger" : "text-muted")}>{p.name}</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-2 font-mono text-[11px] text-foreground/80">
              {JSON.stringify(p.result, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}

export function AgentMessageBubble({ role, content, toolCalls }: AgentMessageBubbleProps) {
  if (role === "TOOL") {
    return (
      <div className="flex justify-start">
        <ToolResultsSummary content={content} />
      </div>
    );
  }

  if (role === "ASSISTANT" && !content && toolCalls?.length) {
    return (
      <div className="flex justify-start">
        <p className="max-w-[85%] rounded-lg bg-surface-light px-3 py-1.5 font-mono text-[11px] text-muted italic">
          Consultando: {toolCalls.map((c) => c.name).join(", ")}…
        </p>
      </div>
    );
  }

  const isUser = role === "USER";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words px-4 py-2.5 text-sm",
          isUser ? "rounded-bubble-br bg-accent text-on-accent" : "rounded-bubble bg-surface border border-border text-foreground"
        )}
      >
        {content}
      </div>
    </div>
  );
}
