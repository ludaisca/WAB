"use client";

import React from "react";
import { cn } from "./cn";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_MAP = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
  xl: "h-14 w-14 text-lg",
};

function getInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

export function Avatar({ src, alt, name, size = "md", className }: AvatarProps) {
  const [error, setError] = React.useState(false);

  if (src && !error) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- src is an arbitrary user-provided URL, not a known domain next/image can optimize
      <img
        src={src}
        alt={alt ?? name ?? "Avatar"}
        onError={() => setError(true)}
        className={cn(
          "rounded-full object-cover border border-border",
          SIZE_MAP[size],
          className
        )}
      />
    );
  }

  const initials = getInitials(name);
  const bgColor = stringToColor(name ?? alt ?? "?");

  return (
    <div
      role="img"
      aria-label={name ?? alt ?? "Avatar"}
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white shrink-0",
        SIZE_MAP[size],
        className
      )}
      style={{ backgroundColor: bgColor }}
    >
      {initials}
    </div>
  );
}

export function AvatarText({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string;
  email?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Avatar name={name} size={size} />
      <div className="min-w-0">
        {name && <p className="text-sm font-medium text-foreground truncate">{name}</p>}
        {email && <p className="text-xs text-muted-darker truncate">{email}</p>}
      </div>
    </div>
  );
}
