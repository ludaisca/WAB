import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MetaApiView } from "./_view";

export default async function MetaApiPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Ya bloqueado en lib/nav-access.ts para user/ejecutivo — redirect defensivo por consistencia.
  if (session.user.role !== "admin") redirect("/dashboard");

  return <MetaApiView />;
}
