import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

export async function setSourceEnabled(id: string, accountIds: string[], enabled: boolean) {
  const existing = await prisma.leadSheetSource.findFirst({ where: { id, waAccountId: { in: accountIds } } });
  if (!existing) throw new NotFoundError("Fuente no encontrada");

  return prisma.leadSheetSource.update({
    where: { id },
    data: { enabled },
    select: { id: true, name: true, enabled: true },
  });
}

export async function deleteSource(id: string, accountIds: string[]) {
  const existing = await prisma.leadSheetSource.findFirst({ where: { id, waAccountId: { in: accountIds } } });
  if (!existing) throw new NotFoundError("Fuente no encontrada");

  await prisma.leadSheetSource.delete({ where: { id } });
}
