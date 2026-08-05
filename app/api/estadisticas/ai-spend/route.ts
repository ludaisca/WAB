import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAiSpendBreakdown, type SpendPreset } from "@/lib/ai/spend-breakdown";

const VALID_PRESETS: SpendPreset[] = ["7d", "28d", "90d", "month", "custom"];

// Mismo gate que /estadisticas (ejecutivo bloqueado por proxy.ts + redirect
// defensivo en la page) — admin y user sí entran, es su propio gasto de IA
// (WABot/WALeadScorerBot que ellos mismos son dueños, igual que getMonthlyAiCost).
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const preset = searchParams.get("preset");
    if (!preset || !VALID_PRESETS.includes(preset as SpendPreset)) {
      return NextResponse.json({ error: "preset inválido (7d|28d|90d|month|custom)" }, { status: 400 });
    }

    let customFrom: Date | undefined;
    let customTo: Date | undefined;
    if (preset === "custom") {
      const fromStr = searchParams.get("from");
      const toStr = searchParams.get("to");
      if (!fromStr || !toStr || Number.isNaN(Date.parse(fromStr)) || Number.isNaN(Date.parse(toStr))) {
        return NextResponse.json({ error: "from/to (YYYY-MM-DD) son requeridos para preset=custom" }, { status: 400 });
      }
      customFrom = new Date(fromStr);
      customTo = new Date(toStr);
    }

    const breakdown = await getAiSpendBreakdown(session.user.id, preset as SpendPreset, customFrom, customTo);
    return NextResponse.json(breakdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
