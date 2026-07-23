import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { toCsv } from "@/lib/csv";
import { exportEntity, isExportEntityKey } from "@/lib/backup/export-entities";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`backup-export:${session.user.id}`, 20, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const url = new URL(req.url);
    const entity = url.searchParams.get("entity") || "";
    const format = url.searchParams.get("format") === "json" ? "json" : "csv";
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    if (!isExportEntityKey(entity)) {
      return NextResponse.json({ error: "Entidad no reconocida" }, { status: 400 });
    }

    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Rango de fecha inválido" }, { status: 400 });
    }

    const result = await exportEntity(entity, { from, to });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${entity}-${stamp}.${format}`;

    if (format === "json") {
      return new Response(JSON.stringify(result.jsonRows, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const csv = "﻿" + toCsv(result.headers, result.rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
