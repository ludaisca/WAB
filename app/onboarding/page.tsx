import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { OnboardingForm } from "./_form";

export const dynamic = "force-dynamic";

// Only reachable on a fresh deploy (0 users). Once the first admin exists,
// this route is dead — new accounts go through /register instead.
export default async function OnboardingPage() {
  const userCount = await prisma.user.count();
  if (userCount > 0) redirect("/login");

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <OnboardingForm />
      </div>
    </div>
  );
}
