import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function DashboardRootPage() {
  const session = await auth();
  if (session?.user?.role === "ejecutivo") redirect("/whatsapp/chat");
  redirect("/dashboard");
}
