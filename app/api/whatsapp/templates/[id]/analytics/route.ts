import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getTemplateAnalytics } from "@/lib/whatsapp/template-analytics";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`template-analytics:${session.user.id}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    // Default window: last 30 days, matching the "Leads calificados" date-filter
    // convention elsewhere in the app.
    const end = endParam ? new Date(`${endParam}T23:59:59`) : new Date();
    const start = startParam ? new Date(`${startParam}T00:00:00`) : new Date(end.getTime() - 29 * 86400000);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
    }

    const template = await prisma.wATemplate.findUnique({
      where: { id },
      include: { waAccount: true },
    });

    if (!template) {
      return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    if (!accountIds.includes(template.waAccountId)) {
      return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
    }

    const account = template.waAccount;
    if (account.channel !== "META_CLOUD" || !account.wabaId || !account.accessToken) {
      return NextResponse.json(
        { error: "Esta cuenta no tiene WABA ID / access token configurado — no se pueden obtener métricas de Meta" },
        { status: 400 }
      );
    }

    const accessToken = decrypt(account.accessToken);
    const result = await getTemplateAnalytics(account.wabaId, accessToken, template.templateId, start, end);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    const totals = result.points.reduce(
      (acc, p) => ({
        sent: acc.sent + p.sent,
        delivered: acc.delivered + p.delivered,
        read: acc.read + p.read,
        clicked: acc.clicked + p.clicked,
      }),
      { sent: 0, delivered: 0, read: 0, clicked: 0 }
    );

    return NextResponse.json({ points: result.points, totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
