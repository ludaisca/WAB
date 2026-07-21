import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { EXPORT_COLUMNS_BY_DATASET, type SheetExportDataset } from "@/lib/whatsapp/export-columns";
import { canUseDataset } from "@/lib/whatsapp/sheet-export-access";

const VALID_DATASETS = Object.keys(EXPORT_COLUMNS_BY_DATASET) as SheetExportDataset[];

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dataset = searchParams.get("dataset") as SheetExportDataset | null;
  if (!dataset || !VALID_DATASETS.includes(dataset)) {
    return NextResponse.json({ error: "Dataset inválido" }, { status: 400 });
  }

  // Espejo del gate de /datasets — sin esto, un rol sin acceso a ese dataset
  // igual podía listar sus columnas (solo metadata, pero inconsistente).
  if (!canUseDataset(session.user.role, dataset)) {
    return NextResponse.json({ error: "Tu rol no permite este tipo de exportación" }, { status: 403 });
  }

  const columns = EXPORT_COLUMNS_BY_DATASET[dataset].map((c) => ({ key: c.key, label: c.label }));
  return NextResponse.json({ columns });
}
