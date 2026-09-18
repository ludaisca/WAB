// Catálogo de versiones del Graph API de Meta que la app permite elegir, y el
// default del código. Sin imports de servidor (prisma, etc.) a propósito: la
// página /configuracion/meta-api (cliente) lo importa para llenar el selector.
// El acceso a la base y la resolución de la versión vigente viven en
// lib/whatsapp/graph-api.ts.
//
// Fechas: https://developers.facebook.com/docs/graph-api/changelog/versions
// Al sumar una versión nueva, añádela aquí; al expirar una, quítala (una fila
// guardada que ya no esté en la lista se ignora y se usa el default).

export const GRAPH_API_ORIGIN = "https://graph.facebook.com";

// Versión que usa el código cuando el admin no eligió ninguna.
export const DEFAULT_GRAPH_API_VERSION = "v25.0";

export interface GraphApiVersionInfo {
  version: string;
  released: string; // ISO date
  expires: string | null; // ISO date; null = Meta aún no la anunció
}

// Más nueva primero. v20.0 no se ofrece: expira el 2026-09-24.
export const GRAPH_API_VERSIONS: GraphApiVersionInfo[] = [
  { version: "v26.0", released: "2026-07-29", expires: null },
  { version: "v25.0", released: "2026-02-18", expires: "2028-07-29" },
  { version: "v24.0", released: "2025-10-08", expires: "2028-02-18" },
  { version: "v23.0", released: "2025-05-29", expires: "2027-10-08" },
  { version: "v22.0", released: "2025-01-21", expires: "2027-05-20" },
  { version: "v21.0", released: "2024-10-02", expires: "2027-01-21" },
];

export function isSupportedGraphApiVersion(value: unknown): value is string {
  return typeof value === "string" && GRAPH_API_VERSIONS.some((v) => v.version === value);
}

export function graphApiBaseFor(version: string): string {
  return `${GRAPH_API_ORIGIN}/${version}`;
}
