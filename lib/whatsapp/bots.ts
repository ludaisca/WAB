import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";

export async function toggleBot(id: string, userId: string) {
  const bot = await prisma.wABot.findFirst({
    where: { id, userId },
    include: { accounts: { select: { waAccountId: true } } },
  });
  if (!bot) throw new NotFoundError("Bot no encontrado");

  const nextActive = !bot.isActive;

  // Nada más impide que dos bots activos compartan la misma cuenta —
  // `ingestInboundMessage()` encola un job por CADA bot activo que encuentra,
  // así que dos activos en la misma cuenta responden dos veces (y gastan
  // doble) al mismo mensaje. Se bloquea aquí, en el único punto de entrada
  // que puede activar un bot — ahora revisando CADA cuenta a la que este bot
  // esté vinculado (un bot puede servir varias cuentas a la vez, ver
  // WABotAccount), no solo una.
  if (nextActive && bot.accounts.length > 0) {
    const conflict = await prisma.wABot.findFirst({
      where: {
        accounts: { some: { waAccountId: { in: bot.accounts.map((a) => a.waAccountId) } } },
        isActive: true,
        status: "ACTIVE",
        id: { not: id },
      },
      select: { name: true },
    });
    if (conflict) {
      throw new ValidationError(`Ya hay un bot activo en esta cuenta ("${conflict.name}") — desactívalo primero`);
    }
  }

  return prisma.wABot.update({
    where: { id },
    // Re-activating clears a stuck ERROR status (e.g. from a past API key or
    // provider failure) so the bot actually resumes receiving messages —
    // isActive alone isn't enough, the message pipeline also requires
    // status: "ACTIVE".
    data: nextActive ? { isActive: true, status: "ACTIVE" } : { isActive: false },
    select: { id: true, name: true, isActive: true, status: true },
  });
}

export async function updateBotSystemPrompt(id: string, userId: string, systemPrompt: string) {
  const bot = await prisma.wABot.findFirst({ where: { id, userId } });
  if (!bot) throw new NotFoundError("Bot no encontrado");

  return prisma.wABot.update({
    where: { id },
    data: { systemPrompt },
    select: { id: true, name: true, systemPrompt: true },
  });
}

export async function deleteBot(id: string, userId: string) {
  const bot = await prisma.wABot.findFirst({ where: { id, userId } });
  if (!bot) throw new NotFoundError("Bot no encontrado");

  await prisma.wABot.delete({ where: { id } });
}
