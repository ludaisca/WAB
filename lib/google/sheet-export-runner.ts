// Reemplaza lib/google/sheets-sync.ts: en vez de sincronizar 2 datasets fijos a
// 2 pestañas fijas, corre cada SheetExport habilitado del usuario contra su
// propio dataset/columnas/filtros/hoja destino. Ver prisma/schema.prisma:SheetExport
// y AGENTS.md para el detalle de las reglas de seguridad (gate de rol por
// dataset, intersección de accountIds, chatAccessWhere para CHATS).

import type { sheets_v4 } from "googleapis";
import type { GoogleAccount, SheetExport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { listSheetTabs, quoteTabTitle } from "@/lib/google/sheets-read";
import { isRevokedGrantError } from "@/lib/google/errors";
import { EXPORT_COLUMNS, CAMPAIGN_EXPORT_COLUMNS, EXPORT_COLUMNS_BY_DATASET, expandLegacyColumnKeys, type ExportColumnDef, type SheetExportDataset } from "@/lib/whatsapp/export-columns";
import { canUseDataset } from "@/lib/whatsapp/sheet-export-access";
import {
  buildLeadScoreRows,
  buildCampaignResultRows,
  buildChatRows,
  buildContactRows,
  type LeadScoresFilters,
  type CampaignResultsFilters,
  type ChatsFilters,
  type ContactsFilters,
} from "@/lib/google/dataset-queries";

// Compare-and-swap atómico: sync-now corre fuera de la cola BullMQ mientras el
// tick de 15 min corre dentro — pueden solaparse para el mismo usuario. Un
// count(SheetExport)===0 tendría ventana TOCTOU (ambos leen 0 antes de que
// ninguno inserte). updateMany con este where es la primitiva atómica correcta:
// el segundo llamador concurrente obtiene count:0 y sale sin tocar nada.
// Exportada: el tick de sheets-sync la usa antes de listar las exportaciones
// (crea las legacy la primera vez). Vive aquí, no en el worker, para que el
// tick y la sincronización manual compartan exactamente la misma migración.
export async function migrateLegacySyncIfNeeded(account: GoogleAccount): Promise<void> {
  if (!account.spreadsheetId) return;

  const claimed = await prisma.googleAccount.updateMany({
    where: { id: account.id, legacyExportsMigratedAt: null },
    data: { legacyExportsMigratedAt: new Date() },
  });
  if (claimed.count === 0) return;

  // skipDuplicates: si el usuario ya creó a mano un export apuntando a la misma
  // (spreadsheetId, sheetName) — ej. usando una de las pestañas sugeridas por el
  // form —, @@unique haría fallar el createMany completo (batch, no atómico por
  // fila) y, como legacyExportsMigratedAt ya quedó marcado por el claim de
  // arriba, la migración quedaría permanentemente abandonada sin reintento. Con
  // skipDuplicates la fila en conflicto simplemente se omite y la otra sí se crea.
  await prisma.sheetExport.createMany({
    skipDuplicates: true,
    data: [
      {
        userId: account.userId,
        name: "Leads calificados",
        dataset: "LEAD_SCORES",
        spreadsheetId: account.spreadsheetId,
        sheetName: "Leads calificados",
        columns: EXPORT_COLUMNS.map((c) => c.key),
        filters: {},
      },
      {
        userId: account.userId,
        name: "Resultados de campaña",
        dataset: "CAMPAIGN_RESULTS",
        spreadsheetId: account.spreadsheetId,
        sheetName: "Resultados de campaña",
        columns: CAMPAIGN_EXPORT_COLUMNS.map((c) => c.key),
        filters: {},
      },
    ],
  });
}

// Exportada (no solo de uso interno) — la ruta POST de creación la llama para
// fallar rápido si la cuenta de Google conectada no tiene permiso de edición
// sobre la hoja pegada, ANTES de crear el registro en DB.
//
// Devuelve el sheetId numérico (GridRange de batchUpdate no acepta notación
// A1): writeSheetTab lo necesita para aplicar el formato de fecha/hora.
export async function ensureSheetTab(sheets: sheets_v4.Sheets, spreadsheetId: string, tabTitle: string): Promise<number | null> {
  const tabs = await listSheetTabs(sheets, spreadsheetId);
  const existing = tabs.find((t) => t.title === tabTitle);
  if (existing) return existing.sheetId;

  try {
    const { data } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] },
    });
    return data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  } catch (err) {
    // sync-now corre fuera de la cola BullMQ — dos ejecuciones concurrentes del
    // mismo export recién creado pueden competir por crear la misma pestaña.
    // Google responde 400 "A sheet with the name ... already exists" en ese caso;
    // se re-lee el sheetId en vez de fallar, cualquier otro error se propaga.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("already exists")) throw err;
    const after = await listSheetTabs(sheets, spreadsheetId);
    return after.find((t) => t.title === tabTitle)?.sheetId ?? null;
  }
}

// Las cuatro formas de fila son distintas; esta capa solo proyecta las columnas
// seleccionadas, así que se trabaja con `any` (igual que
// EXPORT_COLUMNS_BY_DATASET en export-columns.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

// Filas por petición a Sheets. Antes se mandaba TODO en un solo
// values.update: con los 160k destinatarios de "Resultados de campaña" eso
// serializaba decenas de MB de golpe y bloqueaba el event loop del proceso de
// Next (los workers de BullMQ corren ahí mismo, ver instrumentation.ts) —
// el health check dejaba de responder y Docker marcaba el contenedor unhealthy.
const EXPORT_PAGE_SIZE = 2_000;

// Cuota de escritura de Sheets: 60 peticiones por minuto por usuario. Con lotes
// de 2,000 filas un export de 160k son 80 escrituras; sin espaciarlas se
// dispararía un 429 a mitad de la corrida. 1s entre lotes deja el ritmo justo
// por debajo del límite.
const SHEET_WRITE_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSheetValues(
  columns: ExportColumnDef<AnyRow>[],
  rows: AnyRow[],
  includeHeader: boolean
): (string | number)[][] {
  const values: (string | number)[][] = [];
  if (includeHeader) values.push(columns.map((c) => c.label));
  for (const row of rows) {
    values.push(
      // Las columnas con getSheetValue escriben el valor tipado (serial), no el
      // texto: es lo que permite que Sheets las trate como fecha/hora real.
      columns.map((c) => {
        if (!c.getSheetValue) return c.get(row);
        const typed = c.getSheetValue(row);
        return typed === null ? "" : typed;
      })
    );
  }
  return values;
}

async function writeSheetChunk(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  startRow: number,
  columns: ExportColumnDef<AnyRow>[],
  rows: AnyRow[],
  includeHeader: boolean
): Promise<void> {
  const values = buildSheetValues(columns, rows, includeHeader);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteTabTitle(tabTitle)}!A${startRow}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function applySheetFormats(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number | null,
  columns: ExportColumnDef<AnyRow>[]
): Promise<void> {
  // El formato de número es lo que hace visible el serial como fecha/hora. Se
  // reaplica en cada sync (idempotente) para que sobreviva a que alguien
  // reformatee la columna o recree la pestaña. Sin sheetId resuelto no se toca
  // ningún formato: repetir la petición con un id inventado formatearía otra
  // pestaña del libro.
  if (sheetId === null) return;
  const formatRequests = columns.flatMap((c, index) =>
    c.sheetFormat
      ? [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: c.sheetFormat.type, pattern: c.sheetFormat.pattern },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ]
      : []
  );

  if (formatRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }
}

// Pagina cualquier builder: pide lotes de EXPORT_PAGE_SIZE hasta que uno venga
// incompleto. Los builders ordenan con desempate por id, así que el skip es
// estable entre llamadas.
async function* paginate(
  fetchPage: (skip: number, take: number) => Promise<AnyRow[]>
): AsyncGenerator<AnyRow[]> {
  let skip = 0;
  for (;;) {
    const rows = await fetchPage(skip, EXPORT_PAGE_SIZE);
    if (rows.length > 0) yield rows;
    if (rows.length < EXPORT_PAGE_SIZE) return;
    skip += rows.length;
  }
}

interface ExportStreamContext {
  userId: string;
  role: string | undefined;
  accountIds: string[];
  filters: Record<string, unknown>;
  includePublicLink: boolean;
}

// Emite las filas del dataset en lotes, sin materializar el total. Campaign
// Results se pagina por origen (manual / automatización) por separado: cada
// uno tiene su propia query y su propio orden, y mezclarlos en un array
// reconstruido hacía imposible paginar sin duplicar o perder filas.
async function* iterateExportPages(
  dataset: SheetExportDataset,
  ctx: ExportStreamContext
): AsyncGenerator<AnyRow[]> {
  switch (dataset) {
    case "LEAD_SCORES": {
      const filters = ctx.filters as LeadScoresFilters;
      yield* paginate((skip, take) =>
        buildLeadScoreRows(
          ctx.userId,
          ctx.role,
          ctx.accountIds,
          filters,
          { skip, take },
          { includePublicLink: ctx.includePublicLink }
        )
      );
      return;
    }
    case "CAMPAIGN_RESULTS": {
      const filters = ctx.filters as CampaignResultsFilters;
      const origins: ("manual" | "automatizacion")[] = filters.origins?.length
        ? filters.origins
        : ["manual", "automatizacion"];
      for (const origin of origins) {
        yield* paginate((skip, take) =>
          buildCampaignResultRows(ctx.accountIds, { ...filters, origins: [origin] }, { skip, take })
        );
      }
      return;
    }
    case "CHATS": {
      const filters = ctx.filters as ChatsFilters;
      yield* paginate((skip, take) =>
        buildChatRows(ctx.userId, ctx.role, ctx.accountIds, filters, { skip, take })
      );
      return;
    }
    case "CONTACTS": {
      const filters = ctx.filters as ContactsFilters;
      yield* paginate((skip, take) => buildContactRows(ctx.accountIds, filters, { skip, take }));
      return;
    }
  }
}

function intersect(base: string[], subset: string[] | undefined): string[] {
  if (!subset?.length) return base;
  const allowed = new Set(base);
  return subset.filter((id) => allowed.has(id));
}

async function runExport(
  sheets: sheets_v4.Sheets,
  userId: string,
  role: string | undefined,
  baseAccountIds: string[],
  row: SheetExport
): Promise<void> {
  const dataset = row.dataset as SheetExportDataset;

  // Re-chequeo en cada corrida, no solo al crear: un cambio de rol posterior
  // (ej. degradación de admin a user) debe cortar el efecto de inmediato, no
  // solo bloquear altas nuevas. No se deshabilita el export por si el rol se
  // revierte — solo se salta esta corrida.
  if (!canUseDataset(role, dataset)) {
    await prisma.sheetExport.update({
      where: { id: row.id },
      data: { lastSyncError: "Tu rol actual no permite este tipo de exportación — contacta a un administrador" },
    });
    return;
  }

  // La forma real ya quedó validada por zod al crear/editar (ver validations.ts) —
  // el cast aquí es análogo al de `details as LeadScoreRow["details"]` que ya
  // hacía sheets-sync.ts para el Json de WALeadScore.
  const rawFilters = (row.filters ?? {}) as { accountIds?: string[] } & Record<string, unknown>;
  const accountIds = intersect(baseAccountIds, rawFilters.accountIds);

  // Columnas primero: `includePublicLink` decide si buildLeadScoreRows genera
  // tokens públicos (un UPDATE por chat) o los omite. Generarlos para una
  // columna que no se va a escribir era trabajo puro y creaba links que nadie
  // pidió — ver dataset-queries.ts.
  const selected = expandLegacyColumnKeys(row.columns);
  const columns = EXPORT_COLUMNS_BY_DATASET[dataset].filter((c) => selected.includes(c.key));
  if (columns.length === 0) {
    throw new Error("La exportación no tiene columnas seleccionadas");
  }

  const sheetId = await ensureSheetTab(sheets, row.spreadsheetId, row.sheetName);

  const pages = iterateExportPages(dataset, {
    userId,
    role,
    accountIds,
    filters: rawFilters,
    includePublicLink: selected.includes("publicLink"),
  });

  // El primer lote se lee ANTES de limpiar la pestaña: si la query falla, la
  // hoja del usuario conserva los datos de la corrida anterior en vez de quedar
  // vacía. Antes se limpiaba y después se construía todo en memoria.
  const firstPage = await pages.next();
  let firstRows: AnyRow[] = [];
  if (!firstPage.done) firstRows = firstPage.value;

  // Se limpia la pestaña completa (el nombre de pestaña a secas es un rango
  // válido y queda acotado a la grilla real). El viejo A1:Z100000 dejaba fuera
  // de la limpieza cualquier columna más allá de la Z — con 29 columnas eso ya
  // era AA-AC, y si el export se recorta quedarían datos fantasma.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: row.spreadsheetId,
    range: quoteTabTitle(row.sheetName),
  });

  await writeSheetChunk(sheets, row.spreadsheetId, row.sheetName, 1, columns, firstRows, true);
  let nextRow = 1 + firstRows.length;

  if (!firstPage.done) {
    for await (const page of pages) {
      await sleep(SHEET_WRITE_INTERVAL_MS);
      await writeSheetChunk(sheets, row.spreadsheetId, row.sheetName, nextRow, columns, page, false);
      nextRow += page.length;
    }
  }

  await applySheetFormats(sheets, row.spreadsheetId, sheetId, columns);

  await prisma.sheetExport.update({
    where: { id: row.id },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
}

export async function syncExportsForUser(userId: string): Promise<void> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account?.enabled) return;

  const sheets = await getGoogleSheetsClientForUser(userId);
  if (!sheets) return;

  await migrateLegacySyncIfNeeded(account);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const accountIds = await getUserAccountIds(userId);
  const exports = await prisma.sheetExport.findMany({ where: { userId, enabled: true } });

  // Secuencial, no Promise.all: evita saturar la API de Sheets y evita que dos
  // exports del mismo spreadsheet compitan por crear pestañas en paralelo.
  for (const row of exports) {
    try {
      await runExport(sheets, userId, user?.role, accountIds, row);
    } catch (err) {
      // invalid_grant puede aparecer recién en la primera llamada real a la API
      // de Sheets dentro de runExport (el refresh de OAuth es perezoso) — eso
      // es una revocación de la cuenta entera, no un problema de este export
      // puntual: se relanza para que el caller (sheets-sync-worker.ts / la ruta
      // sync-now) la maneje deshabilitando el GoogleAccount, igual que antes.
      if (isRevokedGrantError(err)) throw err;

      const message = err instanceof Error ? err.message : String(err);
      await prisma.sheetExport.update({
        where: { id: row.id },
        data: { lastSyncError: message.slice(0, 500) },
      }).catch(() => {});
      console.error(`[sheet-exports] Error sincronizando export ${row.id} del usuario ${userId}:`, err);
    }
  }
}

export async function syncSingleExport(userId: string, exportId: string): Promise<void> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account?.enabled) throw new Error("No tienes una cuenta de Google conectada");

  const sheets = await getGoogleSheetsClientForUser(userId);
  if (!sheets) throw new Error("No tienes una cuenta de Google conectada");

  const row = await prisma.sheetExport.findFirst({ where: { id: exportId, userId } });
  if (!row) throw new Error("Exportación no encontrada");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const accountIds = await getUserAccountIds(userId);

  // A diferencia del loop de syncExportsForUser, este único export SÍ debe
  // seguir propagando el error al caller (la ruta lo traduce a 502/mensaje de
  // creación) — pero también debe quedar persistido en lastSyncError, o la
  // fila se ve "sana" en la lista hasta el próximo tick de 15 min que sí pasa
  // por ese loop.
  try {
    await runExport(sheets, userId, user?.role, accountIds, row);
  } catch (err) {
    if (isRevokedGrantError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await prisma.sheetExport.update({
      where: { id: row.id },
      data: { lastSyncError: message.slice(0, 500) },
    }).catch(() => {});
    throw err;
  }
}
