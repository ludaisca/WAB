import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { allowedDatasetsForRole, DATASET_LABELS } from "@/lib/whatsapp/sheet-export-access";

// Evita duplicar el gate de rol en el cliente: el <select> del formulario
// consume esto en vez de traer su propia copia de DATASET_ALLOWED_ROLES.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const datasets = allowedDatasetsForRole(session.user.role).map((value) => ({
    value,
    label: DATASET_LABELS[value],
  }));

  return NextResponse.json({ datasets });
}
