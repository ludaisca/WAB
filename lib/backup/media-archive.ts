import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";

interface MediaStats {
  fileCount: number;
  totalBytes: number;
}

async function walkMediaStats(dir: string): Promise<MediaStats> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { fileCount: 0, totalBytes: 0 };
  }

  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    // Directorios de housekeeping transitorios de una restauración en curso
    // (.restore-staging-<id>/.restore-old-<id>, ver restore-backup.ts) — nunca
    // deben contarse ni empaquetarse en un backup nuevo, ni siquiera si una
    // limpieza anterior falló y quedaron huérfanos.
    if (entry.name.startsWith(".restore-")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkMediaStats(full);
      fileCount += sub.fileCount;
      totalBytes += sub.totalBytes;
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      fileCount += 1;
      totalBytes += stat.size;
    }
  }
  return { fileCount, totalBytes };
}

// tar czf del árbol MEDIA_ROOT completo. Se usa el `tar` de BusyBox ya
// presente en la imagen Alpine — sin dependencia npm nueva.
export async function archiveMedia(outputPath: string): Promise<MediaStats> {
  await fs.mkdir(MEDIA_ROOT, { recursive: true });
  const stats = await walkMediaStats(MEDIA_ROOT);
  // --exclude en la propia llamada a tar, no solo en el conteo — si no, un
  // .restore-old-*/.restore-staging-* huérfano (limpieza previa fallida) se
  // seguiría empaquetando dentro del .tar aunque no se contara en el manifest.
  await execFileAsync("tar", ["czf", outputPath, "--exclude=.restore-*", "-C", MEDIA_ROOT, "."], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stats;
}

export async function extractMediaArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["xzf", archivePath, "-C", destDir], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function countExtractedFiles(dir: string): Promise<number> {
  const stats = await walkMediaStats(dir);
  return stats.fileCount;
}
