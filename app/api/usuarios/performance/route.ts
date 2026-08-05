import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getAgentPerformance } from "@/lib/estadisticas/agent-performance";

// Mismo dato que ya se muestra en Estadísticas (tabla de desempeño por
// agente, enterrada en el aside) — se expone aquí para que /usuarios pueda
// mostrarlo por fila sin recalcularlo. Mismo scope de cuentas que el resto
// del app (getUserAccountIds del admin que consulta), no "todo el sistema".
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    const performance = await getAgentPerformance(accountIds);

    return NextResponse.json(performance);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
