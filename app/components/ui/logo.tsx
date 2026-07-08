import Link from "next/link";
import { cn } from "./cn";

type LogoSize = "sm" | "md" | "lg";

const SIZE = {
  sm: { box: "h-7 w-7 text-xs",  text: "text-sm"  },
  md: { box: "h-8 w-8 text-sm",  text: "text-base" },
  lg: { box: "h-9 w-9 text-sm",  text: "text-lg"  },
};

interface LogoProps {
  brand?: string;
  size?: LogoSize;
  href?: string;
  showWordmark?: boolean;
  className?: string;
}

function LogoMark({ size = "md", brand = "W" }: { size?: LogoSize; brand?: string }) {
  return (
    <span className={cn("flex items-center gap-2")}>
      <span
        className={cn(
          "flex items-center justify-center rounded-lg bg-accent text-on-accent font-display font-bold shrink-0 -rotate-3",
          SIZE[size].box
        )}
      >
        {brand.charAt(0).toUpperCase()}
      </span>
      <span className={cn("font-display font-semibold tracking-tight", SIZE[size].text)}>
        {brand}
      </span>
    </span>
  );
}

export function Logo({ brand = "WAB", size = "md", href, showWordmark = true, className }: LogoProps) {
  if (!showWordmark) {
    const box = (
      <span
        className={cn(
          "flex items-center justify-center rounded-lg bg-accent text-on-accent font-bold",
          SIZE[size].box,
          className
        )}
      >
        {brand.charAt(0)}
      </span>
    );
    return href ? <Link href={href}>{box}</Link> : box;
  }

  const mark = <LogoMark size={size} brand={brand} />;

  if (href) {
    return (
      <Link href={href} className={cn("inline-flex", className)}>
        {mark}
      </Link>
    );
  }

  return <div className={cn("inline-flex", className)}>{mark}</div>;
}
