import { Worker } from "bullmq";
import { processBotMessageJob } from "./bot-worker";
import { processCampaignJob, processScheduledCampaignsTick, processStuckCampaignsTick } from "./campaign-worker";
import { processRagJob } from "./rag-worker";
import { processMediaDownloadJob } from "./media-worker";
import { processMediaCleanupJob } from "./media-cleanup-worker";
import { processAudioTranscribeJob } from "./audio-transcribe-worker";
import { processBotSendJob } from "./bot-send-worker";
import { processLeadScoringTick, processBulkRescoreJob } from "./lead-scoring-worker";
import { processLeadRecoveryTick } from "./lead-recovery-worker";
import { processSheetsSyncTick } from "./sheets-sync-worker";
import { processLeadSheetImportTick } from "./lead-sheet-worker";
import { processTemplateSyncTick } from "./template-sync-worker";
import { processAgentActionExpiryTick } from "./agent-action-expiry-worker";
import { processSystemDiagnosticsTick } from "./system-diagnostics-worker";
import { processCrmEjecutivosSyncTick } from "./crm-ejecutivos-sync-worker";
import { processBackupJob, processScheduledBackupTick } from "./backup-worker";
import { processRestoreJob } from "./restore-worker";
import { processReportJob } from "./report-worker";
import { mediaCleanupQueue, leadScoringQueue, leadRecoveryQueue, campaignQueue, sheetsSyncQueue, leadSheetImportQueue, templateSyncQueue, agentActionExpiryQueue, systemDiagnosticsQueue, backupQueue } from "@/lib/queue";
// crmEjecutivosSyncQueue NO se importa aquí — el tick automático está
// desactivado (ver el bloque comentado más abajo), y app/api/crm-ejecutivos/
// sync-now/route.ts ya la importa directo de lib/queue.ts para el trigger manual.
import { MEXICO_CITY_TZ } from "@/lib/timezone";

const connection = {
  url: process.env.REDIS_URL || "redis://redis:6379",
};

let started = false;
const workers: Worker[] = [];

export function startWorkers() {
  if (started) return;
  started = true;

  const botWorker = new Worker("bot-messages", async (job) => {
    await processBotMessageJob(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 3 });

  const campaignWorker = new Worker("campaign-send", async (job) => {
    // La misma cola lleva los envíos ("send"), el tick que reclama campañas
    // SCHEDULED vencidas ("scheduled-tick") y el tick que reclama campañas
    // atoradas en SENDING ("stuck-tick") — concurrency 1 garantiza que ninguno
    // de los dos ticks corre en paralelo con un envío en curso.
    if (job.name === "scheduled-tick") {
      await processScheduledCampaignsTick();
      return;
    }
    if (job.name === "stuck-tick") {
      await processStuckCampaignsTick();
      return;
    }
    await processCampaignJob(job.data);
  }, { connection, concurrency: 1 });

  const ragWorker = new Worker("rag-index", async (job) => {
    await processRagJob(job.data);
  }, { connection, concurrency: 2 });

  const mediaWorker = new Worker("media-download", async (job) => {
    await processMediaDownloadJob(job.data);
  }, { connection, concurrency: 5 });

  const mediaCleanupWorker = new Worker("media-cleanup", async () => {
    await processMediaCleanupJob();
  }, { connection, concurrency: 1 });

  // Transcribe notas de voz entrantes (Google Gemini, modelo por defecto del
  // usuario) — los jobs llegan de media-worker.ts ya con el archivo en disco.
  const audioTranscribeWorker = new Worker("audio-transcribe", async (job) => {
    await processAudioTranscribeJob(job.data);
  }, { connection, concurrency: 3 });

  const botSendWorker = new Worker("bot-message-send", async (job) => {
    await processBotSendJob(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 5 });

  const leadScoringWorker = new Worker("lead-scoring", async (job) => {
    // Misma cola lleva el tick repetible y la recalificación masiva a petición
    // (ver "Recalificar todos los leads" en /whatsapp/calificadores) —
    // concurrency 1 evita que ambas corran en paralelo sobre el mismo calificador.
    if (job.name === "rescore-all") {
      await processBulkRescoreJob(job.data.scorerId);
      return;
    }
    await processLeadScoringTick();
  }, { connection, concurrency: 1 });

  const leadRecoveryWorker = new Worker("lead-recovery", async () => {
    await processLeadRecoveryTick();
  }, { connection, concurrency: 1 });

  const sheetsSyncWorker = new Worker("sheets-sync", async () => {
    await processSheetsSyncTick();
  }, { connection, concurrency: 1 });

  const leadSheetImportWorker = new Worker("lead-sheet-import", async () => {
    await processLeadSheetImportTick();
  }, { connection, concurrency: 1 });

  const templateSyncWorker = new Worker("template-sync", async () => {
    await processTemplateSyncTick();
  }, { connection, concurrency: 1 });

  const agentActionExpiryWorker = new Worker("agent-action-expiry", async () => {
    await processAgentActionExpiryTick();
  }, { connection, concurrency: 1 });

  const systemDiagnosticsWorker = new Worker("system-diagnostics", async () => {
    await processSystemDiagnosticsTick();
  }, { connection, concurrency: 1 });

  const crmEjecutivosSyncWorker = new Worker("crm-ejecutivos-sync", async () => {
    await processCrmEjecutivosSyncTick();
  }, { connection, concurrency: 1 });

  const backupWorker = new Worker("system-backup", async (job) => {
    // Misma cola lleva el tick diario ("scheduled-tick") y los backups
    // manuales disparados desde la UI ("manual") — concurrency 1 evita que dos
    // pg_dump corran en paralelo sobre la misma DB.
    if (job.name === "scheduled-tick") {
      await processScheduledBackupTick();
      return;
    }
    await processBackupJob(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 1 });

  const restoreWorker = new Worker("system-restore", async (job) => {
    await processRestoreJob(job.data);
  }, { connection, concurrency: 1 });

  // Sin tick repetible — v1 de Reportes solo tiene generación manual por
  // botón. concurrency:2 es seguro (a diferencia de pg_dump, generar dos
  // .xlsx en paralelo son solo lecturas, sin estado compartido que corromper).
  const reportWorker = new Worker("report-generate", async (job) => {
    await processReportJob(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 2 });

  workers.push(botWorker, campaignWorker, ragWorker, mediaWorker, mediaCleanupWorker, audioTranscribeWorker, botSendWorker, leadScoringWorker, leadRecoveryWorker, sheetsSyncWorker, leadSheetImportWorker, templateSyncWorker, agentActionExpiryWorker, systemDiagnosticsWorker, backupWorker, restoreWorker, reportWorker, crmEjecutivosSyncWorker);

  // 2am, antes del purge de media-cleanup (3am) — así el backup diario
  // captura los medios que esa limpieza va a purgar esa misma madrugada, no
  // después. La retención/rotación (BACKUP_RETENTION_COUNT) corre al final de
  // cada backup exitoso, ver lib/backup/retention.ts.
  // Todos los patrones cron de abajo llevan `tz: MEXICO_CITY_TZ` explícito —
  // sin esto, BullMQ/cron-parser interpretan el patrón en la zona local del
  // proceso (UTC en el contenedor), así que "0 2 * * *" corría a las 8pm CDMX
  // del día anterior, no a las 2am CDMX como dicen los comentarios.
  backupQueue
    .add(
      "scheduled-tick",
      {},
      { jobId: "system-backup-scheduled-tick", repeat: { pattern: "0 2 * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar system-backup:", err));

  mediaCleanupQueue
    .add(
      "purge",
      {},
      { jobId: "media-cleanup-daily", repeat: { pattern: "0 3 * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar media-cleanup:", err));

  // The shortest schedulable interval a scorer can pick is 15 minutes (see
  // LEAD_SCORER_SCHEDULE_INTERVALS) — ticking every 5 minutes gives enough
  // resolution to honor that without polling Redis unnecessarily often.
  leadScoringQueue
    .add(
      "tick",
      {},
      { jobId: "lead-scoring-tick", repeat: { pattern: "*/5 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar lead-scoring:", err));

  // Las campañas programadas se agendan a minuto exacto en la UI — un tick
  // por minuto es la resolución mínima para honrar esa promesa.
  campaignQueue
    .add(
      "scheduled-tick",
      {},
      { jobId: "campaign-scheduled-tick", repeat: { pattern: "* * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar campaign-scheduled-tick:", err));

  // Reclama campañas atoradas en SENDING con destinatarios PENDING desde hace
  // rato — ver el comentario de processStuckCampaignsTick() en campaign-worker.ts.
  // 10 min de resolución da dos oportunidades de detección dentro del umbral
  // de 20 min sin sondear la DB de más.
  campaignQueue
    .add(
      "stuck-tick",
      {},
      { jobId: "campaign-stuck-tick", repeat: { pattern: "*/10 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar campaign-stuck-tick:", err));

  // Umbrales en horas (mínimo configurable: horas enteras) — un tick cada 15
  // minutos da resolución de sobra sin sondear Redis de más.
  leadRecoveryQueue
    .add(
      "tick",
      {},
      { jobId: "lead-recovery-tick", repeat: { pattern: "*/15 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar lead-recovery:", err));

  // Mismo cron que lead-recovery — resolución de sobra para una sync que no
  // necesita ser casi en tiempo real.
  sheetsSyncQueue
    .add(
      "tick",
      {},
      { jobId: "sheets-sync-tick", repeat: { pattern: "*/15 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar sheets-sync:", err));

  // Un lead de Facebook Ads espera respuesta rápida — mismo cron que lead-scoring
  // (5 min) para no dejarlo esperando de más, acotado por MAX_ROWS_PER_TICK en
  // lib/google/lead-sheet-import.ts para no saturar la API de Meta en una ráfaga.
  leadSheetImportQueue
    .add(
      "tick",
      {},
      { jobId: "lead-sheet-import-tick", repeat: { pattern: "*/5 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar lead-sheet-import:", err));

  // El status de una plantilla (PENDING → APPROVED/REJECTED) antes solo se
  // refrescaba si alguien pulsaba "Sincronizar" — un tick cada 15 minutos evita
  // que quede desactualizado por horas/días si nadie entra a la pantalla.
  templateSyncQueue
    .add(
      "tick",
      {},
      { jobId: "template-sync-tick", repeat: { pattern: "*/15 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar template-sync:", err));

  // Las AgentAction CONFIRM expiran a las 24h de propuestas (ver orchestrator.ts) —
  // 15 min de resolución es de sobra, ninguna acción queda "viva" mucho más de eso.
  agentActionExpiryQueue
    .add(
      "tick",
      {},
      { jobId: "agent-action-expiry-tick", repeat: { pattern: "*/15 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar agent-action-expiry:", err));

  // El barrido reconstruye estado estructural (campañas atascadas, cuentas en
  // error, plantillas rechazadas, etc.), no eventos que cambien segundo a
  // segundo — una hora de resolución es de sobra y evita golpear la DB con
  // el mismo scan completo que ya corre bajo demanda vía la tool system.diagnostics.
  systemDiagnosticsQueue
    .add(
      "tick",
      {},
      { jobId: "system-diagnostics-tick", repeat: { pattern: "0 * * * *", tz: MEXICO_CITY_TZ } }
    )
    .catch((err) => console.error("[workers] No se pudo programar system-diagnostics:", err));

  // Tick automático DESACTIVADO a propósito (Luis, 2026-08-17) — mientras se
  // valida el volumen real (cientos de prospectos por ejecutivo desde que se
  // acotó FLOOR_DATE en client.ts) y se decide qué tan seguido conviene
  // resincronizar sin golpear de más el CRM externo. Por ahora la sync solo
  // corre manual ("Sincronizar ahora" en /crm-ejecutivos, ver sync-now/route.ts).
  // El worker "crmEjecutivosSyncWorker" de arriba sigue registrado y activo
  // — sin el tick de abajo, simplemente nunca recibe trabajo por su cuenta.
  // Para reactivar el tick: descomentar este bloque. Importante — un
  // `.add()` con `repeat` sobrevive en Redis independientemente del código;
  // si esto se desactivó alguna vez y luego se reactiva, confirma con
  // `getRepeatableJobs()` que no quedó un tick viejo duplicado.
  //
  // crmEjecutivosSyncQueue
  //   .add(
  //     "tick",
  //     {},
  //     { jobId: "crm-ejecutivos-sync-tick", repeat: { pattern: "*/15 * * * *", tz: MEXICO_CITY_TZ } }
  //   )
  //   .catch((err) => console.error("[workers] No se pudo programar crm-ejecutivos-sync:", err));

  console.log("[workers] BullMQ workers started");
}

async function shutdown() {
  console.log("[workers] Shutting down workers...");
  await Promise.all(workers.map((w) => w.close()));
  console.log("[workers] Workers shut down");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
