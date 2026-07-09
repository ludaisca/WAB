export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startWorkers } = await import("@/lib/workers");
    startWorkers();

    const { reconnectAllBaileysAccounts } = await import("@/lib/whatsapp-baileys/connection-manager");
    reconnectAllBaileysAccounts();
  }
}
