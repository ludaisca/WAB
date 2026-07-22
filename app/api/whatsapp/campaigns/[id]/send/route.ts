import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { sendCampaign } from "@/lib/whatsapp/campaigns";
import { NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`campaign-send:${session.user.id}`, 5, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados envíos en poco tiempo — intenta de nuevo en un minuto" },
        { status: 429 }
      );
    }

    const { id } = await params;
    await sendCampaign(id, session.user.id);

    return NextResponse.json({
      success: true,
      message: "Campaña encolada para envío",
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
