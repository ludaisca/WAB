const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Meta's 24h customer-service window: free-text messages can only be sent
// within 24h of the lead's last inbound message — after that Meta requires an
// approved template. Shared by lead-recovery.ts and unassigned-lead-reply.ts
// so both features enforce Meta's policy from the same definition.
export function isWithinServiceWindow(lastInboundAt: Date, now: Date): boolean {
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}
