import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { crmEjecutivosSyncQueue } from "@/lib/queue";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { allowed } = await rateLimit(`crm-ejecutivos-sync-now:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

  try {
    // Sin jobId fijo — a propósito. Un jobId determinístico como
    // "crm-ejecutivos-sync-manual" parecía buena idea para deduplicar clics
    // dobles (mismo patrón que campaign-send-<campaignId>), pero BullMQ
    // recuerda ese ID PARA SIEMPRE una vez que el job completa (queda en el
    // set de "completed" hasta que removeOnComplete lo rote) — un segundo
    // "Sincronizar ahora" días después silenciosamente no encolaba nada
    // nuevo (mismo jobId ya usado), el botón parecía funcionar (202) pero no
    // corría ninguna sync real. Confirmado el 2026-08-17. BullMQ genera un
    // ID único por job si no se le da uno — el rate limit de arriba (10/hora)
    // ya cubre el caso de doble-clic sin necesitar dedup por jobId.
    await crmEjecutivosSyncQueue.add("manual", {});
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
