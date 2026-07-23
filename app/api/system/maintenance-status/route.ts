import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/system-maintenance";

// Abierto a cualquier rol logueado (no solo admin) — alimenta el banner
// global: un ejecutivo viendo el chat durante una restauración también debe
// saber por qué los datos pueden verse inconsistentes.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const maintenanceMode = await isMaintenanceMode();
  return NextResponse.json({ maintenanceMode });
}
