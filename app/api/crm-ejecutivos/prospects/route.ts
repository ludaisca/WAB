import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 25;

// Cruce con Contact/WAChat por teléfono — bounded a lo que trae la página
// actual (como mucho PAGE_SIZE claves), nunca escanea la tabla completa de
// Contact. `endsWith` no usa índice (Contact.remoteJid no tiene uno para
// esto) pero con ≤25 condiciones OR por request es equivalente en costo a
// unas pocas decenas de lookups puntuales — mismo criterio de "acotado por
// página, no por tabla completa" que ya usan otras rutas interactivas de
// este repo (ver el gotcha de fetchMessagesInRange en CLAUDE.md).
async function matchContactsByPhoneKeys(phoneKeys: string[]): Promise<Map<string, { contactId: string; chatId: string | null; accountId: string }>> {
  if (phoneKeys.length === 0) return new Map();

  const contacts = await prisma.contact.findMany({
    where: { OR: phoneKeys.map((k) => ({ remoteJid: { endsWith: k } })) },
    select: { id: true, remoteJid: true, accountId: true, chat: { select: { id: true } } },
  });

  const map = new Map<string, { contactId: string; chatId: string | null; accountId: string }>();
  for (const c of contacts) {
    const digits = c.remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
    const key = digits.slice(-10);
    // Si dos contactos distintos comparten los últimos 10 dígitos (muy
    // improbable, pero posible entre cuentas), se queda el primero visto —
    // no hay forma de desambiguar mejor sin el código de país exacto.
    if (!map.has(key)) map.set(key, { contactId: c.id, chatId: c.chat?.id ?? null, accountId: c.accountId });
  }
  return map;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const trackedExecutiveId = searchParams.get("trackedExecutiveId");
    const isOportunity = searchParams.get("isOportunity");
    const onlyMatched = searchParams.get("onlyMatched") === "true";
    const search = searchParams.get("search")?.trim();

    const where: Prisma.ExternalProspectWhereInput = {
      ...(trackedExecutiveId ? { trackedExecutiveId } : {}),
      ...(isOportunity === "true" ? { isOportunity: true } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { product: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // "Solo con match en WAB" tiene que filtrar ANTES de paginar (no solo
    // ocultar filas de la página actual) — si no, "Siguiente" seguiría
    // avanzando por prospectos sin match de por medio y el conteo/paginación
    // no cuadrarían con lo que el usuario realmente ve. Para eso se resuelve
    // el cruce sobre TODOS los phoneKey distintos que matchean el resto de
    // filtros (acotado por el volumen real de ExternalProspect, no de
    // Contact) y se acota el where con `phoneKey: { in: ... }`.
    let matchedKeysPrefetch: Map<string, { contactId: string; chatId: string | null; accountId: string }> | null = null;
    if (onlyMatched) {
      const distinct = await prisma.externalProspect.findMany({
        where,
        select: { phoneKey: true },
        distinct: ["phoneKey"],
      });
      matchedKeysPrefetch = await matchContactsByPhoneKeys(distinct.map((d) => d.phoneKey));
      where.phoneKey = { in: Array.from(matchedKeysPrefetch.keys()) };
    }

    const [total, rows] = await Promise.all([
      prisma.externalProspect.count({ where }),
      prisma.externalProspect.findMany({
        where,
        orderBy: { sourceCreatedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { trackedExecutive: { select: { id: true, label: true, phone: true } } },
      }),
    ]);

    // Si ya se resolvió el cruce completo arriba (onlyMatched), reusarlo en
    // vez de volver a golpear Contact con las mismas claves de esta página.
    const matches = matchedKeysPrefetch ?? (await matchContactsByPhoneKeys(rows.map((r) => r.phoneKey)));

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      product: r.product,
      campaign: r.campaign,
      observations: r.observations,
      isOportunity: r.isOportunity,
      isClient: r.isClient,
      rejected: r.rejected,
      rejectedReason: r.rejectedReason,
      discarted: r.discarted,
      lastTrackingReason: r.lastTrackingReason,
      lastTrackingAt: r.lastTrackingAt?.toISOString() ?? null,
      sourceCreatedAt: r.sourceCreatedAt.toISOString(),
      sourceUpdatedAt: r.sourceUpdatedAt.toISOString(),
      trackedExecutive: r.trackedExecutive,
      wab: matches.get(r.phoneKey) ?? null,
    }));

    return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
