// Cliente del CRM externo de ejecutivos (crmc.limenka360.com) — no es parte
// de WAB, es el otro CRM de la empresa donde ejecutivos humanos trabajan los
// mismos leads por canales fuera de WhatsApp. Endpoint sin autenticación
// (confirmado: responde sin headers, con Access-Control-Allow-Origin: *) —
// no hay credencial que inyectar aquí, es tal cual lo expone ese CRM hoy.
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";

const BASE_URL = "https://crmc.limenka360.com";

// Paginación confirmada por prueba manual: `page` NO tiene efecto (se
// ignora silenciosamente), el esquema real es offset (`skip` + `limit`).
// `count` en la respuesta es el total real que matchea el filtro,
// independiente de skip/limit — es la señal para saber cuándo parar.
// limit=1000 confirmado que sí lo respeta (probado, regresa exactamente
// 1000) — reduce de ~50 a ~5 requests para un ejecutivo con ~5,000
// prospectos, que resultó ser el volumen real (ver FLOOR_DATE de abajo).
const PAGE_SIZE = 1000;
// Techo defensivo de páginas por ejecutivo por corrida — un ejecutivo con
// más de 500,000 prospectos sería un dato atípico que amerita revisar el
// endpoint/la sync en vez de dejar el tick de BullMQ girando indefinidamente.
const MAX_PAGES = 500;

// CRÍTICO — confirmado por prueba manual (curl) el 2026-08-17: sin
// startDate/endDate el endpoint NO regresa "todo el historial", regresa
// SOLO EL DÍA DE HOY (probado: mismo teléfono, sin fechas → count 2, con
// startDate=hoy&endDate=hoy → count 2 idéntico). La primera versión de este
// cliente no mandaba fechas pensando que "sin filtro = todo" — eso hizo que
// semanas de prospectos reales nunca se sincronizaran, con solo 2-3
// registros por ejecutivo en vez de cientos/miles. NUNCA quites estos dos
// parámetros ni los mandes por separado (ver el comentario de
// fetchAllProspects más abajo, misma trampa).
//
// FLOOR_DATE = 1 de julio 2026 por decisión de negocio (Luis, 2026-08-17):
// el CRM externo SÍ tiene registros de años anteriores (probado hasta 2014),
// pero no son relevantes para este negocio — todo lo que importa arrancó en
// julio 2026. Subir el floor más allá de eso (ej. a 2000) solo trae miles de
// registros viejos irrelevantes y hace la sync mucho más lenta sin ganar
// nada. Si algún día hace falta ver histórico anterior a julio 2026, bajar
// este valor — no hay ninguna limitación técnica, es puramente de negocio.
// CEILING_DATE es una fecha futura fija (no "hoy", evita depender del reloj
// del servidor) — ambas deliberadamente estáticas porque esto es un resync
// completo cada corrida, no un filtro por rango real.
const FLOOR_DATE = "2026-07-01";
const CEILING_DATE = "2099-12-31";

export interface RawExternalProspect {
  id: string;
  name?: string;
  lastname?: string;
  fullname?: string;
  email?: string;
  product?: string;
  phone: string;
  observations?: string;
  isoportunity?: boolean;
  isclient?: boolean;
  rejected?: boolean;
  rejectedreason?: string;
  discarted?: boolean;
  discartedreason?: string;
  campaign?: string;
  lastTracking?: { reason?: string } | null;
  lastTrackingcreatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface ProspectsResponse {
  results: RawExternalProspect[];
  count: number;
}

// Trae TODOS los prospectos de un ejecutivo, paginando con skip/limit hasta
// agotar `count`. Un fetch fallido a mitad de la paginación se propaga (el
// worker decide si reintenta ese ejecutivo en el siguiente tick) en vez de
// devolver una lista parcial silenciosa que un upsert luego tomaría como "ya
// no existen" (esta sync no borra lo que deja de ver, así que ese riesgo
// concreto no aplica hoy, pero una lista parcial sí podría ocultar cambios de
// estado reales de prospectos que quedaron fuera de la página obtenida).
//
// SIEMPRE manda startDate+endDate (FLOOR_DATE/CEILING_DATE) — nunca los
// quites ni los mandes por separado. Dos trampas confirmadas por prueba
// manual en este endpoint:
//   1) Sin AMBOS parámetros, el filtro de fecha no se activa — pero además
//      (la trampa gorda, ver el comentario de FLOOR_DATE arriba) SIN
//      NINGUNO de los dos el endpoint no regresa "todo", regresa solo el
//      día de hoy. Es lo opuesto de "sin filtro = todo el historial".
//   2) startDate o endDate mandados POR SEPARADO (uno sin el otro) también
//      se ignoran en silencio — ni error, ni filtran correctamente.
// Ninguna de las dos formas de fallar da un error HTTP distinto — ambas
// regresan 200 con un `count` que parece válido pero está mal.
export async function fetchAllProspects(ejecutivephone: string): Promise<RawExternalProspect[]> {
  const all: RawExternalProspect[] = [];
  let skip = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE_URL}/agents/get-all-prospects?ejecutivephone=${encodeURIComponent(ejecutivephone)}&order=-createdAt&startDate=${FLOOR_DATE}&endDate=${CEILING_DATE}&limit=${PAGE_SIZE}&skip=${skip}`;
    const res = await fetchWithTimeout(url, 15000);
    if (!res.ok) {
      throw new Error(`CRM Ejecutivos respondió ${res.status} para ejecutivephone=${ejecutivephone}`);
    }
    const data = (await res.json()) as ProspectsResponse;
    all.push(...data.results);
    skip += PAGE_SIZE;
    if (skip >= data.count || data.results.length === 0) break;
  }

  return all;
}
