import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEstadisticas } from "@/lib/estadisticas/get-stats";
import { EstadisticasView } from "./_view";

export default async function EstadisticasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // El rol "ejecutivo" ya está bloqueado a nivel de proxy.ts (middleware),
  // se mantiene el redirect defensivo por consistencia.
  if (session.user.role === "ejecutivo") redirect("/whatsapp/chat");

  const stats = await getEstadisticas(session.user.id);

  return <EstadisticasView stats={stats} />;
}
