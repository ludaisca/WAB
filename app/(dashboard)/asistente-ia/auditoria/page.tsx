import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuditoriaView } from "./_view";

export default async function AuditoriaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const actions = await prisma.agentAction.findMany({
    where: { userId: session.user.id },
    include: { resolvedBy: { select: { name: true, email: true } }, conversation: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <AuditoriaView
      initialActions={actions.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        riskTier: a.riskTier,
        description: a.description,
        status: a.status,
        errorMessage: a.errorMessage,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
        resolvedBy: a.resolvedBy,
        conversation: a.conversation,
      }))}
    />
  );
}
