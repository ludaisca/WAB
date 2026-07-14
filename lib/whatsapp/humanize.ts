// Splits a bot reply into separate WhatsApp messages and computes a per-chunk
// typing delay, so a long reply doesn't read as an obviously automated wall of text.
// Used only when WABot.humanizeEnabled is on.

export function splitReply(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

const MIN_DELAY_MS = 800;
const MAX_DELAY_MS = 8000;
const MS_PER_CHAR = 40;

export function computeTypingDelay(chunk: string): number {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, chunk.length * MS_PER_CHAR));
}
