import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { invalidateGraphApiVersionCache } from "@/lib/whatsapp/graph-api";
import {
  DEFAULT_GRAPH_API_VERSION,
  GRAPH_API_VERSIONS,
  isSupportedGraphApiVersion,
} from "@/lib/whatsapp/graph-api-versions";

// Config de la versión del Graph API de Meta — admin-only en las 3 capas
// (nav oculto, /configuracion/meta-api en lib/nav-access.ts, 403 aquí).

async function readState() {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "default" },
    select: {
      graphApiVersion: true,
      graphApiVersionUpdatedAt: true,
      graphApiVersionUpdatedBy: true,
    },
  });
  const stored = config?.graphApiVersion ?? null;
  // Un valor guardado que ya no esté en el catálogo se ignora (mismo criterio
  // que lib/whatsapp/graph-api.ts) — se reporta el default como efectivo.
  const override = stored && isSupportedGraphApiVersion(stored) ? stored : null;
  return {
    effective: override ?? DEFAULT_GRAPH_API_VERSION,
    override,
    default: DEFAULT_GRAPH_API_VERSION,
    updatedAt: config?.graphApiVersionUpdatedAt?.toISOString() ?? null,
    updatedBy: config?.graphApiVersionUpdatedBy ?? null,
    versions: GRAPH_API_VERSIONS,
  };
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    return NextResponse.json(await readState());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`meta-api-version:${session.user.id}`, 20, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const body = (await req.json().catch(() => null)) as { version?: string | null } | null;
    if (!body || !("version" in body)) {
      return NextResponse.json({ error: "Falta la versión" }, { status: 400 });
    }

    // null / "" = volver al default del código.
    const requested = body.version ? body.version : null;
    if (requested !== null && !isSupportedGraphApiVersion(requested)) {
      return NextResponse.json({ error: "Versión no soportada" }, { status: 400 });
    }

    const who = session.user.email ?? session.user.name ?? session.user.id;
    // Volver al default anula las TRES columnas (no solo la versión): así la base
    // queda idéntica a como estaba antes de esta función y un rollback del deploy
    // a una versión sin estas columnas no encuentra datos que descartar — un
    // `db push` sin --accept-data-loss aborta si la columna a borrar tiene valores.
    // El rastro de quién lo revirtió queda en el console.warn de abajo.
    const data =
      requested === null
        ? { graphApiVersion: null, graphApiVersionUpdatedAt: null, graphApiVersionUpdatedBy: null }
        : {
            graphApiVersion: requested,
            graphApiVersionUpdatedAt: new Date(),
            graphApiVersionUpdatedBy: who,
          };
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });

    // Rastro de auditoría en logs: un cambio de versión afecta todos los envíos.
    console.warn(`[graph-api] ${who} cambió la versión de Meta a ${requested ?? `(default ${DEFAULT_GRAPH_API_VERSION})`}`);

    invalidateGraphApiVersionCache();
    return NextResponse.json(await readState());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
