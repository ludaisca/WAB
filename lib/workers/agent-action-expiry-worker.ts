// Tick desatendido que vence las AgentAction CONFIRM que nadie confirmó ni
// rechazó dentro de su ventana (expiresAt, 24h desde que se propusieron) —
// sin esto una acción PENDING quedaría eternamente accionable, incluso mucho
// después de que el estado real del sistema pudo haber cambiado.

import { prisma } from "@/lib/prisma";

export async function processAgentActionExpiryTick() {
  const now = new Date();
  await prisma.agentAction.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED", resolvedAt: now },
  });
}
