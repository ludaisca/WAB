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
import { listSheetTabs } from "@/lib/google/sheets-read";
import { isRevokedGrantError } from "@/lib/google/errors";
import { EXPORT_COLUMNS, CAMPAIGN_EXPORT_COLUMNS, EXPORT_COLUMNS_BY_DATASET, type ExportColumnDef, type SheetExportDataset } from "@/lib/whatsapp/export-columns";
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
async function migrateLegacySyncIfNeeded(account: GoogleAccount): Promise<void> {
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
export async function ensureSheetTab(sheets: sheets_v4.Sheets, spreadsheetId: string, tabTitle: string): Promise<void> {
  const tabs = await listSheetTabs(sheets, spreadsheetId);
  if (tabs.some((t) => t.title === tabTitle)) return;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] },
    });
  } catch (err) {
    // sync-now corre fuera de la cola BullMQ — dos ejecuciones concurrentes del
    // mismo export recién creado pueden competir por crear la misma pestaña.
    // Google responde 400 "A sheet with the name ... already exists" en ese caso;
    // se trata como éxito silencioso, cualquier otro error se propaga.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("already exists")) throw err;
  }
}

// Notación A1: una comilla simple dentro de un nombre de pestaña entrecomillado
// se escapa duplicándola (regla del propio grammar de Sheets) — sin esto, un
// sheetName con apóstrofe (ej. "Leads Q1's", tab title es texto libre en el
// formulario) produce un rango inválido y la sincronización falla en cada tick.
function quoteTabTitle(tabTitle: string): string {
  return `'${tabTitle.replace(/'/g, "''")}'`;
}

async function writeSheetTab<T>(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  columns: ExportColumnDef<T>[],
  rows: T[]
): Promise<void> {
  const values = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.get(r)))];
  const quotedTitle = quoteTabTitle(tabTitle);

  // Rango fijo y generoso: se limpia primero para no dejar "filas fantasma" si
  // el dataset actual es más corto que el de la sincronización anterior, luego
  // se escribe todo de nuevo en una sola llamada.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quotedTitle}!A1:Z100000`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quotedTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
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

  let rows: unknown[] = [];
  switch (dataset) {
    case "LEAD_SCORES":
      rows = await buildLeadScoreRows(userId, role, accountIds, rawFilters as LeadScoresFilters);
      break;
    case "CAMPAIGN_RESULTS":
      rows = await buildCampaignResultRows(accountIds, rawFilters as CampaignResultsFilters);
      break;
    case "CHATS":
      rows = await buildChatRows(userId, role, accountIds, rawFilters as ChatsFilters);
      break;
    case "CONTACTS":
      rows = await buildContactRows(accountIds, rawFilters as ContactsFilters);
      break;
  }

  await ensureSheetTab(sheets, row.spreadsheetId, row.sheetName);
  const columns = EXPORT_COLUMNS_BY_DATASET[dataset].filter((c) => row.columns.includes(c.key));
  await writeSheetTab(sheets, row.spreadsheetId, row.sheetName, columns, rows);

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
