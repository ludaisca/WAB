import { prisma } from "@/lib/prisma";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { readSheetValues } from "@/lib/google/sheets-read";
import { getTemplateVariables, renderTemplateText } from "@/lib/whatsapp/template-variables";
import { sendTemplateMessage } from "@/lib/whatsapp/send-template";
import { saveMediaFromMeta, isImageMime, isVideoMime } from "@/lib/whatsapp/media-store";
import { shouldUpdateName } from "@/lib/whatsapp/contact-name";
import { parseLeadDate } from "@/lib/google/parse-lead-date";
import type { LeadSheetSource, WAAccount, WATemplate } from "@prisma/client";

// Tope por corrida del tick automático — evita que una ráfaga de filas nuevas (o una
// hoja recién conectada con muchas filas) sature la API de Meta o bloquee el worker
// (concurrency:1) por demasiado tiempo. El resto se recoge en el siguiente tick (5 min).
const MAX_ROWS_PER_TICK = 30;
// Tope más alto para "Importar leads existentes" — es una acción manual explícita,
// no un tick recurrente, así que se tolera una corrida más larga.
const MAX_ROWS_BACKFILL = 500;

export type SourceWithRelations = LeadSheetSource & { waAccount: WAAccount; waTemplate: WATemplate };

export interface ImportResult {
  imported: number;
  failed: number;
  skipped: number;
}

interface ImportOptions {
  // Reprocesa filas marcadas "seeded" (vistas al conectar la fuente, sin enviar) —
  // usado por el botón "Importar leads existentes".
  includeExisting?: boolean;
  limit?: number;
  // Solo marca las filas actuales como "seeded" sin enviar nada — usado al crear
  // una fuente, para que el primer tick automático solo dispare con leads nuevos.
  seedOnly?: boolean;
  // Filtra el histórico por la fecha de registro del lead (columna `dateColumn`),
  // ambos límites inclusivos — usado por "Importar por fecha". Requiere que la
  // fila tenga una fecha que parseLeadDate haya podido interpretar sin ambigüedad;
  // filas sin fecha resuelta (columna vacía o formato ambiguo) quedan fuera del
  // filtro en vez de arriesgarse a incluir/excluir con una lectura incorrecta.
  dateFrom?: Date | null;
  dateTo?: Date | null;
}

function mediaMessageTypeFromMime(mimeType: string): string {
  if (isImageMime(mimeType)) return "image";
  if (isVideoMime(mimeType)) return "video";
  return "document";
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function findColumnIndex(header: string[], columnName: string): number {
  const target = columnName.trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === target);
}

export async function importNewLeadsForSource(
  source: SourceWithRelations,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  const sheets = await getGoogleSheetsClientForUser(source.userId);
  if (!sheets) {
    throw new Error("La cuenta de Google no está conectada o fue deshabilitada");
  }

  const rows = await readSheetValues(sheets, source.spreadsheetId, source.sheetName);
  if (rows.length < 2) {
    await prisma.leadSheetSource.update({ where: { id: source.id }, data: { lastRunAt: new Date() } });
    return { imported: 0, failed: 0, skipped: 0 };
  }

  const header = rows[0];
  const dataRows = rows.slice(1);

  const phoneIdx = findColumnIndex(header, source.phoneColumn);
  if (phoneIdx === -1) {
    throw new Error(`No se encontró la columna de teléfono "${source.phoneColumn}" en la hoja`);
  }
  const nameIdx = source.nameColumn ? findColumnIndex(header, source.nameColumn) : -1;
  const dateIdx = source.dateColumn ? findColumnIndex(header, source.dateColumn) : -1;
  const bodyColumnNames = (source.bodyColumns as unknown as string[]) ?? [];
  const bodyIdxs = bodyColumnNames.map((c) => findColumnIndex(header, c));

  const existingRows = await prisma.leadSheetImportedRow.findMany({ where: { sourceId: source.id } });
  const existingByPhone = new Map(existingRows.map((r) => [r.phoneNumber, r]));

  if (opts.seedOnly) {
    let seeded = 0;
    for (const row of dataRows) {
      const phone = normalizePhone(row[phoneIdx] ?? "");
      if (!phone || existingByPhone.has(phone)) continue;
      const seedContactName = nameIdx !== -1 ? row[nameIdx] || null : null;
      const seedDate = parseLeadDate(dateIdx !== -1 ? row[dateIdx] : null);
      await prisma.leadSheetImportedRow.create({
        data: {
          sourceId: source.id,
          phoneNumber: phone,
          contactName: seedContactName,
          status: "seeded",
          leadDateRaw: seedDate.raw,
          leadDate: seedDate.date,
        },
      });
      existingByPhone.set(phone, {
        id: "",
        sourceId: source.id,
        phoneNumber: phone,
        contactName: seedContactName,
        status: "seeded",
        rotatedValue: null,
        leadDateRaw: seedDate.raw,
        leadDate: seedDate.date,
        wamid: null,
        deliveredAt: null,
        readAt: null,
        errorMessage: null,
        importedAt: new Date(),
      });
      seeded++;
    }
    await prisma.leadSheetSource.update({ where: { id: source.id }, data: { lastRunAt: new Date() } });
    return { imported: 0, failed: 0, skipped: seeded };
  }

  const candidates: { row: string[]; phone: string }[] = [];
  for (const row of dataRows) {
    const phone = normalizePhone(row[phoneIdx] ?? "");
    if (!phone) continue;
    const existing = existingByPhone.get(phone);
    const isCandidate = !existing || (opts.includeExisting && existing.status === "seeded");
    if (!isCandidate) continue;
    if (opts.dateFrom || opts.dateTo) {
      const { date } = parseLeadDate(dateIdx !== -1 ? row[dateIdx] : null);
      if (!date) continue;
      if (opts.dateFrom && date < opts.dateFrom) continue;
      if (opts.dateTo && date > opts.dateTo) continue;
    }
    candidates.push({ row, phone });
  }

  const limit = opts.limit ?? MAX_ROWS_PER_TICK;
  const toProcess = candidates.slice(0, limit);

  const result: ImportResult = { imported: 0, failed: 0, skipped: 0 };
  if (toProcess.length === 0) {
    await prisma.leadSheetSource.update({
      where: { id: source.id },
      data: { lastRunAt: new Date(), lastImportedCount: 0, lastError: null },
    });
    return result;
  }

  const templateVars = getTemplateVariables(source.waTemplate.components);
  const templateName = source.waTemplate.name;
  const language = source.waTemplate.language;

  // Header media (si aplica) se descarga una sola vez para toda la corrida, igual
  // que campaign-worker.ts — no por cada lead. No es fatal si falla: el envío sigue,
  // solo no se ve el thumbnail del header en el CRM.
  let headerMedia: { relativePath: string; mimeType: string; bytesSize: number } | null = null;
  if (source.headerParam && templateVars.header.format && templateVars.header.format !== "TEXT") {
    try {
      const stored = await saveMediaFromMeta(source.waAccountId, source.headerParam, source.waAccount.accessToken!);
      headerMedia = { relativePath: stored.relativePath, mimeType: stored.remoteMimeType, bytesSize: stored.bytesSize };
    } catch {
      headerMedia = null;
    }
  }

  // Rotación round-robin de una variable del body: reparte los leads entre
  // ejecutivos 1 a 1. El cursor arranca donde lo dejó la corrida anterior (vive
  // en la fuente) para que la rotación no se reinicie en cada tick de 5 min.
  const rotatingValues = (source.rotatingValues as unknown as string[] | null)?.filter(Boolean) ?? [];
  const rotatingIdx = rotatingValues.length > 0 ? source.rotatingParamIndex : null;
  let cursor = source.rotationCursor;

  const leadAdsTag = await prisma.tag.upsert({
    where: { name: `Lead Ads: ${source.name}` },
    create: { name: `Lead Ads: ${source.name}` },
    update: {},
  });

  for (const { row, phone } of toProcess) {
    // El valor rotado se calcula por lead, pero el cursor solo avanza cuando el
    // envío sale bien: si a un ejecutivo le falla un lead no pierde su turno.
    const rotatedValue =
      rotatingIdx !== null ? rotatingValues[cursor % rotatingValues.length] : null;
    // Se recorre por la cantidad de variables que pide la plantilla (no por la de
    // columnas guardadas), para no quedarse corto si la config no cubre todas.
    const paramCount = Math.max(templateVars.bodyParamCount, bodyIdxs.length);
    const bodyParams = Array.from({ length: paramCount }, (_, i) => {
      if (i === rotatingIdx && rotatedValue !== null) return rotatedValue;
      const idx = bodyIdxs[i] ?? -1;
      return idx === -1 ? "" : row[idx] ?? "";
    });
    const contactName = nameIdx !== -1 ? row[nameIdx] || phone : phone;
    const leadDate = parseLeadDate(dateIdx !== -1 ? row[dateIdx] : null);
    const leadDateFields = { leadDateRaw: leadDate.raw, leadDate: leadDate.date };

    const contact = await prisma.contact.findUnique({
      where: { accountId_remoteJid: { accountId: source.waAccountId, remoteJid: phone } },
    });
    if (contact?.optedOutMarketing) {
      await prisma.leadSheetImportedRow.upsert({
        where: { sourceId_phoneNumber: { sourceId: source.id, phoneNumber: phone } },
        create: {
          sourceId: source.id,
          phoneNumber: phone,
          contactName,
          status: "skipped",
          errorMessage: "El contacto optó por no recibir mensajes de marketing",
          ...leadDateFields,
        },
        update: { contactName, status: "skipped", errorMessage: "El contacto optó por no recibir mensajes de marketing", ...leadDateFields },
      });
      result.skipped++;
      continue;
    }

    try {
      const { wamid } = await sendTemplateMessage(source.waAccount, {
        to: phone,
        templateName,
        language,
        bodyParams,
        bodyParamNames: templateVars.bodyParamNames,
        headerFormat: templateVars.header.format,
        headerParam: source.headerParam,
        buttonIndex: templateVars.buttonUrl?.index ?? null,
        buttonParam: source.buttonParam,
      });

      const sentAt = new Date();
      const messageBody =
        renderTemplateText(source.waTemplate.components, { bodyParams, headerParam: source.headerParam }) ||
        `Plantilla: ${templateName}`;

      const contactNameShouldUpdate = shouldUpdateName(contactName, contact?.name, phone);

      const upsertedContact = await prisma.contact.upsert({
        where: { accountId_remoteJid: { accountId: source.waAccountId, remoteJid: phone } },
        create: { accountId: source.waAccountId, remoteJid: phone, name: contactName },
        update: contactNameShouldUpdate ? { name: contactName } : {},
      });

      const existingChat = await prisma.wAChat.findUnique({
        where: { accountId_remoteJid: { accountId: source.waAccountId, remoteJid: phone } },
        select: { name: true },
      });
      const chatNameShouldUpdate = shouldUpdateName(contactName, existingChat?.name, phone);

      const chat = await prisma.wAChat.upsert({
        where: { accountId_remoteJid: { accountId: source.waAccountId, remoteJid: phone } },
        create: {
          accountId: source.waAccountId,
          remoteJid: phone,
          name: contactName,
          contactId: upsertedContact.id,
          lastMessage: messageBody.slice(0, 500),
          lastMessageAt: sentAt,
        },
        update: {
          ...(chatNameShouldUpdate ? { name: contactName } : {}),
          lastMessage: messageBody.slice(0, 500),
          lastMessageAt: sentAt,
        },
      });

      await prisma.wAMessage.create({
        data: {
          wamid: wamid ?? null,
          chatId: chat.id,
          direction: "OUTBOUND",
          messageType: headerMedia ? mediaMessageTypeFromMime(headerMedia.mimeType) : "template",
          body: messageBody,
          mediaId: headerMedia ? source.headerParam : null,
          mediaUrl: headerMedia ? headerMedia.relativePath : null,
          mimeType: headerMedia ? headerMedia.mimeType : null,
          bytesSize: headerMedia ? headerMedia.bytesSize : null,
          status: "sent",
          timestamp: sentAt,
          leadSheetSourceId: source.id,
        },
      });

      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId: upsertedContact.id, tagId: leadAdsTag.id } },
        create: { contactId: upsertedContact.id, tagId: leadAdsTag.id },
        update: {},
      });
      await prisma.chatTag.upsert({
        where: { chatId_tagId: { chatId: chat.id, tagId: leadAdsTag.id } },
        create: { chatId: chat.id, tagId: leadAdsTag.id },
        update: {},
      });

      await prisma.leadSheetImportedRow.upsert({
        where: { sourceId_phoneNumber: { sourceId: source.id, phoneNumber: phone } },
        create: { sourceId: source.id, phoneNumber: phone, contactName, status: "sent", wamid: wamid ?? null, rotatedValue, ...leadDateFields },
        update: { contactName, status: "sent", wamid: wamid ?? null, errorMessage: null, rotatedValue, ...leadDateFields },
      });
      result.imported++;
      // El turno solo se consume con un envío exitoso.
      if (rotatingIdx !== null) cursor++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error desconocido";
      await prisma.leadSheetImportedRow.upsert({
        where: { sourceId_phoneNumber: { sourceId: source.id, phoneNumber: phone } },
        create: { sourceId: source.id, phoneNumber: phone, contactName, status: "failed", errorMessage, ...leadDateFields },
        update: { contactName, status: "failed", errorMessage, ...leadDateFields },
      });
      result.failed++;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  await prisma.leadSheetSource.update({
    where: { id: source.id },
    data: {
      lastRunAt: new Date(),
      lastImportedCount: result.imported,
      lastError: result.failed > 0 ? `${result.failed} de ${toProcess.length} fallaron en la última corrida` : null,
      // Se guarda acotado al tamaño de la lista para que el entero no crezca sin
      // límite; el siguiente tick retoma la rotación donde quedó.
      ...(rotatingIdx !== null ? { rotationCursor: cursor % rotatingValues.length } : {}),
    },
  });

  return result;
}

export const LEAD_SHEET_MAX_BACKFILL = MAX_ROWS_BACKFILL;
