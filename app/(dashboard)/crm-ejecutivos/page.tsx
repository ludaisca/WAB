import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CrmEjecutivosView } from "./_view";

export default async function CrmEjecutivosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Ya bloqueado en proxy.ts (vía lib/nav-access.ts) para user/ejecutivo —
  // redirect defensivo por consistencia, mismo patrón que /reportes.
  if (session.user.role !== "admin") redirect("/dashboard");

  return <CrmEjecutivosView />;
}
