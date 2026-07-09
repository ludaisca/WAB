import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { IconBox } from "./icon-box";
import { cn } from "./cn";

type Tone = "accent" | "success" | "warning" | "danger" | "info" | "neutral";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  tone?: Tone;
  sublabel?: string;
  href?: string;
  className?: string;
}

export function StatCard({ label, value, icon, tone = "accent", sublabel, href, className }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <IconBox icon={icon} size="md" tone={tone} />
        {href && (
          <ArrowUpRight size={14} className="text-muted-darker opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="text-sm text-muted mt-0.5">{label}</p>
        {sublabel && (
          <p className="text-xs text-muted-darker mt-1">{sublabel}</p>
        )}
      </div>
    </>
  );

  const classes = cn(
    "rounded-xl border border-border bg-surface p-5 flex flex-col gap-4 group transition-colors",
    href && "hover:border-accent/30 hover:bg-surface-light cursor-pointer",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
