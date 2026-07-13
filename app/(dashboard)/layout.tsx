import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });

  return <DashboardShell businessName={config?.businessName}>{children}</DashboardShell>;
}
