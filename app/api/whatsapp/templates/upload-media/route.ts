import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";
import { uploadTemplateHeaderMedia } from "@/lib/whatsapp/resumable-upload";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const rl = await rateLimit(`template-media-upload:${session.user.id}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas subidas, intenta más tarde" }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const waAccountId = form.get("waAccountId");

    if (!(file instanceof File) || typeof waAccountId !== "string") {
      return NextResponse.json({ error: "Faltan parámetros (file, waAccountId)" }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    if (!accountIds.includes(waAccountId)) {
      return NextResponse.json({ error: "No tienes acceso a esta cuenta" }, { status: 403 });
    }

    const account = await prisma.wAAccount.findFirst({
      where: { id: waAccountId },
      select: { appId: true, accessToken: true },
    });

    if (!account?.accessToken) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 400 });
    }
    if (!account.appId) {
      return NextResponse.json(
        { error: "Esta cuenta no tiene un App ID configurado. Agrégalo en Detalles de la cuenta." },
        { status: 400 }
      );
    }

    const accessToken = decrypt(account.accessToken);
    const buffer = Buffer.from(await file.arrayBuffer());

    const handle = await uploadTemplateHeaderMedia(
      account.appId,
      accessToken,
      buffer,
      file.type || "application/octet-stream"
    );

    return NextResponse.json({ handle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
