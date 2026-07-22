import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AsistenteIaView } from "./_view";

export default async function AsistenteIaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Ya bloqueado en proxy.ts para user/ejecutivo — redirect defensivo por consistencia.
  if (session.user.role !== "admin") redirect("/dashboard");

  const conversations = await prisma.agentConversation.findMany({
    where: { userId: session.user.id },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <AsistenteIaView
      initialConversations={conversations.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))}
    />
  );
}
