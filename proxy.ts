import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";
import { PROTECTED, canAccessRoute, fallbackRouteFor } from "@/lib/nav-access";

// Las listas de bloqueo por rol viven en lib/nav-access.ts — único lugar,
// para que el command palette (Fase 6) las reuse sin duplicarlas.
const AUTH = ["/login", "/register"];
const EXCLUDE = ["/_next", "/api", "/favicon.ico"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (EXCLUDE.some((e) => path.startsWith(e))) {
    return NextResponse.next();
  }

  const session = await auth();
  const isLoggedIn = !!session?.user;
  const role = session?.user?.role;

  if (AUTH.some((r) => path.startsWith(r))) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL(fallbackRouteFor(role), req.url));
    }
    return NextResponse.next();
  }

  if (PROTECTED.some((r) => path === r || path.startsWith(r + "/"))) {
    if (!isLoggedIn) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", path);
      return NextResponse.redirect(loginUrl);
    }

    if (!canAccessRoute(role, path)) {
      return NextResponse.redirect(new URL(fallbackRouteFor(role), req.url));
    }
  }

  return NextResponse.next();
}

// Sin este matcher, Next.js corre el middleware en TODA petición (incl.
// /api/*) — el `EXCLUDE` de arriba solo hace un return temprano DESPUÉS de
// que la maquinaria de middleware ya envolvió el request, y esa maquinaria
// trunca bodies binarios grandes en subidas por streaming (confirmado: una
// subida de 134MB al restore de backups se cortaba siempre en el mismo punto,
// ~10.4MB, exclusivamente cuando pasaba por el middleware — un pipeline
// idéntico sin middleware de por medio, o vía `next start` en producción,
// transfiere el archivo completo sin problema). Excluir /api aquí a nivel de
// Next.js, no solo dentro de la función, evita ese envoltorio por completo.
export const config = {
  matcher: ["/((?!api|_next|favicon.ico).*)"],
};
