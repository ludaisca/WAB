// Fuente única de las listas de rutas bloqueadas por rol. Antes vivían solo
// dentro de proxy.ts (middleware) — se extraen aquí para que cualquier otro
// consumidor (el command palette de Fase 6, que nunca debe ofrecer saltar a
// una ruta que el middleware va a rebotar) pueda preguntar "¿esto es
// alcanzable para este rol?" sin duplicar las listas ni arriesgarse a que
// diverjan de lo que proxy.ts realmente aplica.

export const PROTECTED = ["/dashboard", "/configuracion", "/whatsapp", "/usuarios", "/estadisticas", "/asistente-ia", "/reportes"];

export const EXECUTIVE_BLOCKED = [
  "/dashboard",
  "/estadisticas",
  "/whatsapp/bots",
  "/whatsapp/campanas",
  "/whatsapp/plantillas",
  "/usuarios",
  "/whatsapp/cuentas",
  "/configuracion/ia",
  "/asistente-ia",
  "/configuracion/backups",
  "/reportes",
];

// Rol "user" conserva Panel/Estadísticas/Chats/Cuentas/Plantillas/Campañas/
// Config, pero pierde Contactos y Bots IA por completo (la antigua página
// /whatsapp/conocimiento se eliminó — el flujo de conocimiento vive en la
// pestaña del bot, ya bloqueada vía /whatsapp/bots). Calificadores de Leads
// sigue alcanzable (no bloqueada aquí) — esa página se autorrestringe
// client-side a solo la pestaña "Leads calificados", ya que el CRUD no es
// una ruta separada que bloquear. /configuracion/ia (API keys, modelo por
// defecto, presupuesto, recuperación de leads) es admin-only — solo el
// dueño de la cuenta administra config de IA, no roles compartidos/delegados.
export const USER_BLOCKED = ["/whatsapp/contactos", "/whatsapp/bots", "/configuracion/ia", "/asistente-ia", "/configuracion/backups", "/reportes"];

function matches(path: string, list: string[]): boolean {
  return list.some((r) => path === r || path.startsWith(r + "/"));
}

/**
 * Misma lógica de bloqueo que proxy.ts aplica. `role` indefinido (sin
 * sesión) nunca cae en las listas de abajo — PROTECTED + la ausencia de
 * sesión ya se resuelven aparte (redirect a /login), este helper solo
 * responde "¿el rol que SÍ tiene sesión puede entrar aquí?".
 */
export function canAccessRoute(role: string | undefined, path: string): boolean {
  if (role === "ejecutivo" && matches(path, EXECUTIVE_BLOCKED)) return false;
  if (role === "user" && matches(path, USER_BLOCKED)) return false;
  return true;
}

/** A dónde cae cada rol bloqueado — mismo destino que proxy.ts usa hoy. */
export function fallbackRouteFor(role: string | undefined): string {
  return role === "ejecutivo" ? "/whatsapp/chat" : "/dashboard";
}
