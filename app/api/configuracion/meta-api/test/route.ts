import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { graphApiBaseFor, isSupportedGraphApiVersion } from "@/lib/whatsapp/graph-api-versions";

// "Probar" una versión del Graph API ANTES de guardarla. Solo lecturas (GET):
// no envía mensajes ni modifica nada en Meta. Usa la cuenta que el admin elija.

interface CheckResult {
  name: string;
  ok: boolean;
  status: number | null;
  code: number | null;
  message: string | null;
  ms: number;
}

async function runCheck(name: string, url: string, accessToken: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, 10_000, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    return {
      name,
      ok: res.ok,
      status: res.status,
      code: json.error?.code ?? null,
      message: res.ok ? null : (json.error?.message ?? `HTTP ${res.status}`),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: null,
      code: null,
      message: err instanceof Error && err.name === "AbortError" ? "Tiempo de espera agotado (10s)" : "No se pudo contactar a Meta",
      ms: Date.now() - t0,
    };
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`meta-api-test:${session.user.id}`, 20, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const body = (await req.json().catch(() => null)) as { version?: string; accountId?: string } | null;
    if (!body?.version || !isSupportedGraphApiVersion(body.version)) {
      return NextResponse.json({ error: "Versión no soportada" }, { status: 400 });
    }
    if (!body.accountId) {
      return NextResponse.json({ error: "Elige una cuenta para probar" }, { status: 400 });
    }

    // Membresía vía getUserAccountIds (propias + compartidas), nunca userId directo.
    const accountIds = await getUserAccountIds(session.user.id);
    if (!accountIds.includes(body.accountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }
    const account = await prisma.wAAccount.findUnique({
      where: { id: body.accountId },
      select: { name: true, phoneNumberId: true, wabaId: true, accessToken: true },
    });
    if (!account?.accessToken || !account.phoneNumberId) {
      return NextResponse.json({ error: "La cuenta no tiene token o phone number ID configurados" }, { status: 400 });
    }

    let accessToken: string;
    try {
      accessToken = decrypt(account.accessToken);
    } catch {
      return NextResponse.json(
        { error: "No se pudo descifrar el token de la cuenta (¿ENCRYPTION_KEY distinta a la que lo cifró?)" },
        { status: 422 }
      );
    }

    const base = graphApiBaseFor(body.version);
    const checks: CheckResult[] = [
      await runCheck(
        "Número de teléfono",
        `${base}/${account.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        accessToken
      ),
    ];
    if (account.wabaId) {
      checks.push(
        await runCheck("Plantillas", `${base}/${account.wabaId}/message_templates?limit=1&fields=name,status`, accessToken)
      );
    }

    return NextResponse.json({
      version: body.version,
      account: account.name,
      ok: checks.every((c) => c.ok),
      checks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
