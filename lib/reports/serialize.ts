import type { SystemReport, User } from "@prisma/client";

type SystemReportWithCreator = SystemReport & { createdBy?: Pick<User, "id" | "name" | "email"> | null };

// A diferencia de serializeBackup (lib/backup/serialize.ts), sizeBytes aquí
// es Int, no BigInt — no necesita .toString() para cruzar NextResponse.json().
export function serializeReport(r: SystemReportWithCreator) {
  return {
    id: r.id,
    status: r.status,
    rangeFrom: r.rangeFrom,
    rangeTo: r.rangeTo,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdBy: r.createdBy ?? null,
  };
}
