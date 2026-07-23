import type { SystemBackup, SystemRestoreLog, User } from "@prisma/client";

type BackupWithCreator = SystemBackup & { createdBy?: Pick<User, "id" | "name" | "email"> | null };

// sizeBytes es BigInt en el schema (evita overflow >2.1GB) — JSON.stringify no
// lo serializa nativamente, hay que convertirlo aquí.
export function serializeBackup(b: BackupWithCreator) {
  return {
    id: b.id,
    type: b.type,
    status: b.status,
    filename: b.filename,
    sizeBytes: b.sizeBytes !== null ? b.sizeBytes.toString() : null,
    manifest: b.manifest,
    errorMessage: b.errorMessage,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
    createdBy: b.createdBy ?? null,
  };
}

type RestoreLogWithRelations = SystemRestoreLog & {
  requestedBy?: Pick<User, "id" | "name" | "email"> | null;
  sourceBackup?: Pick<SystemBackup, "id" | "type"> | null;
  safetyBackup?: Pick<SystemBackup, "id" | "filename"> | null;
};

export function serializeRestoreLog(r: RestoreLogWithRelations) {
  return {
    id: r.id,
    status: r.status,
    sourceType: r.sourceType,
    sourceFilename: r.sourceFilename,
    sourceBackup: r.sourceBackup ?? null,
    safetyBackup: r.safetyBackup ?? null,
    requestedBy: r.requestedBy ?? null,
    encryptionKeyMismatch: r.encryptionKeyMismatch,
    postRestoreWarnings: r.postRestoreWarnings,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}
