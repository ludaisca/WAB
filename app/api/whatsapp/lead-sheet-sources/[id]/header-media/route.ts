import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { rateLimit } from "@/lib/rate-limit";
import { replaceHeaderMedia } from "@/lib/google/lead-sheet-header";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";

// Reemplaza el archivo de la cabecera (imagen/video/documento) de la fuente: sube
// el archivo nuevo a Meta con la cuenta de la fuente y guarda el media id nuevo.
// Necesario cuando el anterior caducó (Meta los borra a los ~30 días).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`lead-sheet-header-media:${session.user.id}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Demasiadas subidas, intenta más tarde" }, { status: 429 });
    }

    const { id } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "El archivo supera el límite de 20MB" }, { status: 413 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id, waAccountId: { in: accountIds } },
      include: { waAccount: true, waTemplate: true },
    });
    if (!source) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    const format = getTemplateVariables(source.waTemplate.components).header.format;
    if (!format || format === "TEXT") {
      return NextResponse.json({ error: "La plantilla de esta fuente no tiene cabecera de medio" }, { status: 400 });
    }

    const mediaId = await replaceHeaderMedia(
      source,
      source.waAccount,
      Buffer.from(await file.arrayBuffer()),
      file.name || `header-${Date.now()}`,
      file.type || "application/octet-stream"
    );
    return NextResponse.json({ headerParam: mediaId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
