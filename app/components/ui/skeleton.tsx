import { cn } from "./cn";

const SHIMMER =
  "bg-surface-light bg-[length:200%_100%] bg-gradient-to-r from-surface-light via-border to-surface-light animate-[shimmer_1.5s_linear_infinite]";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-md", SHIMMER, className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 && lines > 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonRow({ cols = 4, className }: { cols?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)} aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4 flex-1", i === 0 && "max-w-[120px]")} />
      ))}
    </div>
  );
}
