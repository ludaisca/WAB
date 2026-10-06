import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { sha256File } from "@/lib/backup/checksum";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";

// Un archivo recién escrito puede estar a mitad de una corrida (el archivo se
// guarda ANTES de crear la fila WAMessage que lo referencia) — nunca se toca
// nada más joven que esto.
const GRACE_MS = 48 * 60 * 60 * 1000;

interface MediaFile {
  rel: string; // "<accountId>/<archivo>", igual que WAMessage.mediaUrl
  abs: string;
  size: number;
  mtimeMs: number;
}

// Estructura real: MEDIA_ROOT/<accountId>/<archivo>. Se ignoran los
// directorios transitorios de una restauración (.restore-*) y cualquier
// archivo oculto.
async function listMediaFiles(): Promise<MediaFile[]> {
  const out: MediaFile[] = [];
  let dirs;
  try {
    dirs = await fs.readdir(MEDIA_ROOT, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
    const entries = await fs.readdir(path.join(MEDIA_ROOT, dir.name), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const abs = path.join(MEDIA_ROOT, dir.name, entry.name);
      try {
        const stat = await fs.stat(abs);
        out.push({ rel: `${dir.name}/${entry.name}`, abs, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // desapareció entre el readdir y el stat
      }
    }
  }
  return out;
}

async function unlinkQuiet(abs: string): Promise<boolean> {
  try {
    await fs.unlink(abs);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[media-maintenance] No se pudo borrar ${abs}:`, err);
    }
    return false;
  }
}

// Archivos con contenido idéntico (misma cuenta) → una sola copia en disco.
// Las cabeceras de campaña se guardaban una vez por corrida, así que había
// cientos de copias del mismo PDF/imagen. Para no hashear todo el árbol cada
// noche, solo se hashean los archivos que comparten tamaño exacto con otro —
// dos archivos de distinto tamaño no pueden ser iguales.
export async function dedupeMediaFiles(): Promise<{ removed: number; freedBytes: number }> {
  const files = await listMediaFiles();
  const cutoff = Date.now() - GRACE_MS;

  const bySize = new Map<string, MediaFile[]>();
  for (const f of files) {
    if (f.size === 0 || f.mtimeMs > cutoff) continue;
    const key = `${f.rel.split("/")[0]}:${f.size}`;
    const list = bySize.get(key);
    if (list) list.push(f);
    else bySize.set(key, [f]);
  }

  let removed = 0;
  let freedBytes = 0;
  for (const group of bySize.values()) {
    if (group.length < 2) continue;

    const byHash = new Map<string, MediaFile[]>();
    for (const f of group) {
      const hash = await sha256File(f.abs).catch(() => null);
      if (!hash) continue;
      const list = byHash.get(hash);
      if (list) list.push(f);
      else byHash.set(hash, [f]);
    }

    for (const dups of byHash.values()) {
      if (dups.length < 2) continue;
      // La copia más antigua queda como canónica.
      dups.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const [keep, ...extra] = dups;

      // Primero se re-apuntan los mensajes, luego se borra: así, si algo falla
      // a medias, ningún mensaje queda apuntando a un archivo inexistente.
      await prisma.wAMessage.updateMany({
        where: { mediaUrl: { in: extra.map((f) => f.rel) } },
        data: { mediaUrl: keep.rel },
      });
      for (const f of extra) {
        if (await unlinkQuiet(f.abs)) {
          removed += 1;
          freedBytes += f.size;
        }
      }
    }
  }
  return { removed, freedBytes };
}

// Archivos que ningún WAMessage referencia (restos de convenciones de nombres
// anteriores, mensajes borrados, etc.): solo ocupan espacio y entran a cada
// respaldo. La única referencia a este árbol es WAMessage.mediaUrl.
export async function purgeOrphanMediaFiles(): Promise<{ removed: number; freedBytes: number }> {
  const files = await listMediaFiles();
  if (files.length === 0) return { removed: 0, freedBytes: 0 };

  const rows = await prisma.wAMessage.findMany({
    where: { mediaUrl: { not: null } },
    distinct: ["mediaUrl"],
    select: { mediaUrl: true },
  });
  const referenced = new Set(rows.map((r) => r.mediaUrl!));

  // Red de seguridad: con archivos en disco pero CERO referencias en la base,
  // lo más probable es un problema de datos (restauración incompleta, tabla
  // vacía), no que todo sea basura — no se borra nada.
  if (referenced.size === 0) {
    console.warn("[media-maintenance] 0 referencias en la base con archivos en disco — se omite la limpieza de huérfanos");
    return { removed: 0, freedBytes: 0 };
  }

  const cutoff = Date.now() - GRACE_MS;
  let removed = 0;
  let freedBytes = 0;
  for (const f of files) {
    if (f.mtimeMs > cutoff || referenced.has(f.rel)) continue;
    // resolveAbsolutePath valida que la ruta no escape de MEDIA_ROOT.
    if (await unlinkQuiet(resolveAbsolutePath(f.rel))) {
      removed += 1;
      freedBytes += f.size;
    }
  }
  return { removed, freedBytes };
}
