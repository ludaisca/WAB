import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLeadScoreAccuracy } from "@/lib/crm-ejecutivos/score-correlation";
import { getTrackingAnalytics } from "@/lib/crm-ejecutivos/tracking-analytics";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const trackedExecutiveId = searchParams.get("trackedExecutiveId") || undefined;
    const [accuracy, trackingAnalytics] = await Promise.all([
      getLeadScoreAccuracy(trackedExecutiveId),
      getTrackingAnalytics(trackedExecutiveId),
    ]);
    return NextResponse.json({ ...accuracy, trackingAnalytics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
