import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BackupsView } from "./_view";

export default async function BackupsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Ya bloqueado en proxy.ts para user/ejecutivo — redirect defensivo por consistencia.
  if (session.user.role !== "admin") redirect("/dashboard");

  return <BackupsView />;
}
