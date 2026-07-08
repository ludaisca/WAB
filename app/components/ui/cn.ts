/**
 * Utility to merge Tailwind class strings cleanly.
 * Lightweight alternative to clsx/twMerge — no extra deps needed.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
