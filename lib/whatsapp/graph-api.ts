// Única fuente de verdad de la versión del Graph API de Meta. Todo call site
// (mensajes, media, plantillas, analytics, subida resumible) construye su URL
// con `await getGraphApiBase()` — nunca escribas "graph.facebook.com/vNN.0" a
// mano.
//
// La versión vigente sale de SystemConfig.graphApiVersion (editable por el
// admin en /configuracion/meta-api) y cae al default del código si está vacía.
// Regla de oro: esto NUNCA debe lanzar ni bloquear un envío — ante cualquier
// fallo de lectura (base caída, columna aún no creada por un `db push`
// pendiente, valor fuera del catálogo) se usa el default.

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_GRAPH_API_VERSION,
  graphApiBaseFor,
  isSupportedGraphApiVersion,
} from "@/lib/whatsapp/graph-api-versions";

// Un cambio hecho en la UI se propaga a todos los consumidores en, como
// máximo, este tiempo — sin reiniciar nada. TTL corto en vez de depender solo
// de invalidar en memoria: en dev Turbopack puede duplicar módulos entre rutas
// y workers, y una invalidación local no llegaría a todos.
const CACHE_TTL_MS = 30_000;
// Si la lectura falla, no reintentar la base en cada llamada de un envío masivo.
const ERROR_TTL_MS = 5_000;

interface CacheEntry {
  version: string;
  expiresAt: number;
}

// En globalThis para que las copias duplicadas del módulo compartan caché.
const globalForGraph = globalThis as unknown as { __graphApiVersionCache?: CacheEntry };

export function invalidateGraphApiVersionCache(): void {
  globalForGraph.__graphApiVersionCache = undefined;
}

/** Versión efectiva ahora mismo (override del admin o default del código). */
export async function getGraphApiVersion(): Promise<string> {
  const cached = globalForGraph.__graphApiVersionCache;
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.version;

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { id: "default" },
      select: { graphApiVersion: true },
    });
    const stored = config?.graphApiVersion ?? null;
    let version = DEFAULT_GRAPH_API_VERSION;
    if (stored) {
      if (isSupportedGraphApiVersion(stored)) {
        version = stored;
      } else {
        console.warn(
          `[graph-api] SystemConfig.graphApiVersion="${stored}" no está en el catálogo; se usa ${DEFAULT_GRAPH_API_VERSION}`
        );
      }
    }
    globalForGraph.__graphApiVersionCache = { version, expiresAt: now + CACHE_TTL_MS };
    return version;
  } catch (err) {
    console.error("[graph-api] no se pudo leer la versión configurada, usando el default:", err);
    globalForGraph.__graphApiVersionCache = {
      version: DEFAULT_GRAPH_API_VERSION,
      expiresAt: now + ERROR_TTL_MS,
    };
    return DEFAULT_GRAPH_API_VERSION;
  }
}

/** Base de las URLs de Graph: `https://graph.facebook.com/vNN.0`. */
export async function getGraphApiBase(): Promise<string> {
  return graphApiBaseFor(await getGraphApiVersion());
}
