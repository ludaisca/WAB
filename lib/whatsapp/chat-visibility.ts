// Visibilidad de chats por rol.
//
// Los roles `user` y `ejecutivo` pueden tener oculto todo chat "sin origen"
// (el que no nació de una campaña masiva ni de una automatización de Google
// Sheets), cuenta por cuenta, vía WAAccount.hideUnattributedChats. El admin
// siempre lo ve todo.
//
// El criterio de "tiene origen" es exactamente el mismo que pinta el badge de
// campaña en el inbox — ver CHAT_ATTRIBUTION_MESSAGE_QUERY en chat-attribution.ts.
// Si ese criterio cambia, cambia aquí también o el badge y el filtro divergen.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

/** Un chat "tiene origen" si algún mensaje suyo está atribuido a campaña o automatización. */
export const ATTRIBUTED_CHAT_FILTER: Prisma.WAChatWhereInput = {
  messages: {
    some: {
      OR: [{ campaignId: { not: null } }, { leadSheetSourceId: { not: null } }],
    },
  },
};

/** Solo el admin escapa al filtro; user y ejecutivo lo sufren. */
export function bypassesChatVisibility(role: string | undefined): boolean {
  return role === "admin";
}

/**
 * Construye el fragmento `where` que restringe qué chats ve este usuario,
 * dentro de las cuentas a las que ya tiene acceso.
 *
 * Devuelve `null` cuando no hay nada que restringir (rol admin, o ninguna de
 * sus cuentas tiene el toggle activo) — así los llamadores se ahorran meter un
 * AND inútil en la query.
 */
export async function getChatVisibilityFilter(
  userId: string,
  role: string | undefined,
  accountIds: string[]
): Promise<Prisma.WAChatWhereInput | null> {
  if (bypassesChatVisibility(role) || accountIds.length === 0) return null;

  const restricted = await prisma.wAAccount.findMany({
    where: { id: { in: accountIds }, hideUnattributedChats: true },
    select: { id: true },
  });

  if (restricted.length === 0) return null;

  const restrictedIds = restricted.map((a) => a.id);
  const openIds = accountIds.filter((id) => !restrictedIds.includes(id));

  return buildVisibilityWhere(restrictedIds, openIds);
}

/**
 * `where` completo de "a qué chats llega este usuario": las cuentas a las que
 * tiene acceso, ya recortadas por la visibilidad de su rol.
 *
 * Es el guard que deben usar todas las rutas por chat — si una lo omite, un
 * ejecutivo puede leer por id un chat que el inbox le oculta.
 */
export async function chatAccessWhere(
  userId: string,
  role: string | undefined
): Promise<Prisma.WAChatWhereInput> {
  const accountIds = await getUserAccountIds(userId);
  const visibility = await getChatVisibilityFilter(userId, role, accountIds);
  const base: Prisma.WAChatWhereInput = { accountId: { in: accountIds } };
  return visibility ? { ...base, AND: [visibility] } : base;
}

/**
 * Une los dos grupos de cuentas en una sola condición.
 *
 * - `restrictedIds`: cuentas con hideUnattributedChats = true → de estas solo
 *   deben pasar los chats que cumplan ATTRIBUTED_CHAT_FILTER.
 * - `openIds`: el resto de sus cuentas → de estas pasa cualquier chat.
 *
 * El fragmento se combina siempre bajo el `AND` del llamador, que ya trae su
 * propio `accountId` — solo puede restar acceso, nunca ensancharlo.
 */
function buildVisibilityWhere(
  restrictedIds: string[],
  openIds: string[]
): Prisma.WAChatWhereInput {
  // ATTRIBUTED_CHAT_FILTER va anidado bajo AND, no esparcido: así su clave
  // `messages` no puede pisar (ni ser pisada por) otro filtro de messages[]
  // que el llamador ya traiga — el inbox filtra por campaña justamente así.
  const restricted: Prisma.WAChatWhereInput = {
    accountId: { in: restrictedIds },
    AND: [ATTRIBUTED_CHAT_FILTER],
  };

  // Sin cuentas abiertas no hace falta el OR — evita una rama `in: []` muerta
  // en cada query.
  if (openIds.length === 0) return restricted;

  return { OR: [{ accountId: { in: openIds } }, restricted] };
}
