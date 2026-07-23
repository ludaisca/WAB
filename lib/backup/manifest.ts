import { z } from "zod";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// version 1: forma inicial del manifest. Si el layout cambia de forma
// incompatible en el futuro, subir este número y ramificar validateManifest
// por versión — nunca reinterpretar un manifest viejo con el schema nuevo.
export const BACKUP_MANIFEST_VERSION = 1;

export const backupManifestSchema = z.object({
  version: z.literal(BACKUP_MANIFEST_VERSION),
  createdAt: z.string(),
  type: z.enum(["MANUAL", "SCHEDULED", "PRE_RESTORE"]),
  generatedBy: z.object({ userId: z.string(), email: z.string() }).nullable(),
  prismaSchemaHash: z.string(),
  postgresVersion: z.string(),
  // Primeros 16 hex de sha256(ENCRYPTION_KEY) — nunca la key en sí. Permite
  // comparar origen vs. destino sin exponer nada; ver restore-backup.ts.
  encryptionKeyFingerprint: z.string(),
  tableCounts: z.record(z.string(), z.number()),
  mediaFileCount: z.number(),
  mediaTotalBytes: z.number(),
  dbDumpSha256: z.string(),
  mediaArchiveSha256: z.string(),
  totalSizeBytes: z.number(),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function validateManifest(data: unknown): BackupManifest {
  return backupManifestSchema.parse(data);
}

export function encryptionKeyFingerprint(): string {
  const key = process.env.ENCRYPTION_KEY || "";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export async function prismaSchemaHash(): Promise<string> {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  const content = await fs.readFile(schemaPath, "utf8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
