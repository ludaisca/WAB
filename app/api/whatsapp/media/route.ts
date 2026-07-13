import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { uploadMedia } from "@/lib/whatsapp";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";
import { saveMediaFromBuffer } from "@/lib/whatsapp/media-store";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const rl = await rateLimit(`media-upload:${session.user.id}`, 20, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas subidas, intenta más tarde" }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const accountId = form.get("accountId");

    if (!(file instanceof File) || typeof accountId !== "string") {
      return NextResponse.json({ error: "Faltan parámetros (file, accountId)" }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    if (!accountIds.includes(accountId)) {
      return NextResponse.json({ error: "No tienes acceso a esta cuenta" }, { status: 403 });
    }

    const account = await prisma.wAAccount.findFirst({
      where: { id: accountId },
      select: { id: true, phoneNumberId: true, accessToken: true },
    });

    if (!account) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const bytesSize = buffer.length;


    if (!account.phoneNumberId || !account.accessToken) {
      return NextResponse.json({ error: "La cuenta no soporta subida de medios" }, { status: 400 });
    }

    const accessToken = decrypt(account.accessToken);

    const uploaded = await uploadMedia(
      account.phoneNumberId,
      accessToken,
      buffer,
      file.name || `media-${Date.now()}`,
      file.type || "application/octet-stream"
    );

    // Persist a local copy so historical/preview rendering works without re-fetching from Meta.
    let localMediaPath: string | null = null;
    try {
      const stored = await saveMediaFromBuffer(account.id, buffer, file.type || null);
      localMediaPath = stored.relativePath;
    } catch (err) {
      console.error("[media-upload] Local copy failed:", err);
    }

    return NextResponse.json({
      mediaId: uploaded.id,
      mimeType: file.type || null,
      filename: file.name || null,
      bytesSize,
      localMediaPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}