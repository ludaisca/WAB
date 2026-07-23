export type BackupType = "MANUAL" | "SCHEDULED" | "PRE_RESTORE";
export type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type RestoreStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface BackupManifestSummary {
  version: number;
  createdAt: string;
  type: BackupType;
  mediaFileCount: number;
  mediaTotalBytes: number;
  totalSizeBytes: number;
  tableCounts: Record<string, number>;
  encryptionKeyFingerprint: string;
}

export interface RestorePreviewResponse {
  sourceType: "HISTORY" | "UPLOADED";
  historyId?: string;
  uploadToken?: string;
  sourceFilename: string;
  manifest: BackupManifestSummary;
  encryptionKeyMismatch: boolean;
  tableCountDiffs: Array<{ table: string; current: number; backup: number }>;
}

export interface BackupItem {
  id: string;
  type: BackupType;
  status: BackupStatus;
  filename: string | null;
  sizeBytes: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string | null; email: string } | null;
}

export interface RestoreLogItem {
  id: string;
  status: RestoreStatus;
  sourceType: "UPLOADED" | "HISTORY";
  sourceFilename: string;
  encryptionKeyMismatch: boolean;
  postRestoreWarnings: unknown;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  requestedBy: { id: string; name: string | null; email: string } | null;
}
