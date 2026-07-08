import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/dashboard", "/configuracion", "/whatsapp", "/usuarios", "/estadisticas"];
const EXECUTIVE_BLOCKED = ["/dashboard", "/estadisticas", "/whatsapp/bots", "/whatsapp/conocimiento", "/whatsapp/campanas", "/whatsapp/plantillas", "/usuarios", "/whatsapp/cuentas"];
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
  const isEjecutivo = role === "ejecutivo";

  if (AUTH.some((r) => path.startsWith(r))) {
    if (isLoggedIn) {
      const target = isEjecutivo ? "/whatsapp/chat" : "/dashboard";
      return NextResponse.redirect(new URL(target, req.url));
    }
    return NextResponse.next();
  }

  if (PROTECTED.some((r) => path === r || path.startsWith(r + "/"))) {
    if (!isLoggedIn) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", path);
      return NextResponse.redirect(loginUrl);
    }

    if (isEjecutivo && EXECUTIVE_BLOCKED.some((r) => path === r || path.startsWith(r + "/"))) {
      return NextResponse.redirect(new URL("/whatsapp/chat", req.url));
    }
  }

  return NextResponse.next();
}
