import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findUnassignedLeadChats } from "@/lib/whatsapp/unassigned-lead-reply";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const chats = await findUnassignedLeadChats(session.user.id, new Date());
    return NextResponse.json({ chats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
