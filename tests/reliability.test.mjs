import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { test, beforeEach, afterEach, mock } from "node:test";
import load from "./helpers/load-typescript.mjs";

const require = createRequire(import.meta.url);
const { Prisma } = require("@prisma/client");
beforeEach(() => mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); }));
afterEach(() => mock.restoreAll());
const routeMocks = { "@/lib/maintenance-guard": { withMaintenanceGuard: handler => handler } };
const auth = { auth: async () => ({ user: { id: "user", role: "admin" } }) };

function authCallbacks(current) {
  let config;
  load("lib/auth.ts", {
    "next-auth": { __esModule: true, default: value => { config = value; return {}; } },
    "next-auth/providers/credentials": { __esModule: true, default: value => value },
    "bcryptjs": { __esModule: true, default: { compare: async () => true } },
    "./prisma": { prisma: { user: { findUnique: async () => current.value } } },
    "./rate-limit": { rateLimit: async () => ({ allowed: true }) },
  });
  return config;
}

test("sesiones: primer admin conserva acceso y cambios de contraseña/rol o baja revocan JWT", async () => {
  const row = { value: { id: "first-admin", password: "hash-one", role: "admin", name: "Admin", email: "admin@example.invalid", createdAt: new Date() } };
  const config = authCallbacks(row);
  const user = await config.providers[0].authorize({ email: row.value.email, password: "test" }, new Request("http://ludaisca/test"));
  const token = await config.callbacks.jwt({ token: {}, user });
  assert.equal(token.role, "admin");
  assert.ok(!JSON.stringify(token).includes("hash-one"));
  assert.equal((await config.callbacks.jwt({ token: { ...token } })).role, "admin");
  row.value = { ...row.value, role: "user" };
  assert.equal(await config.callbacks.jwt({ token: { ...token } }), null);
  row.value = { ...row.value, role: "admin", password: "hash-two" };
  assert.equal(await config.callbacks.jwt({ token: { ...token } }), null);
  row.value = null;
  assert.equal(await config.callbacks.jwt({ token: { ...token } }), null);
  assert.equal(await config.callbacks.jwt({ token: { id: "legacy", role: "admin" } }), null);
});

test("medios: valida rutas canónicas de la cuenta y rechaza rutas absolutas, normalizadas o ajenas", () => {
  const { assertAccountMediaPath } = load("lib/whatsapp/media-path.ts");
  assert.doesNotThrow(() => assertAccountMediaPath("own", "own/file.webp"));
  for (const value of ["other/file.pdf", "/app/media/own/file.pdf", "own/../other/file.pdf", "own//file.pdf", "own/./file.pdf", "own/file/child", "own\\file.pdf", "own/..", "own/", "own/file\0.pdf"]) {
    assert.throws(() => assertAccountMediaPath("own", value), value);
  }
});

test("medios: conocer la ruta, incluso de la misma cuenta, no sustituye un recibo de carga propio", async () => {
  const stored = new Map();
  const code = load("lib/whatsapp/media-upload.ts", {
    "@/lib/redis": { getRedisClient: () => ({ set: async (key, value) => stored.set(key, value), get: async key => stored.get(key) }) },
  });
  const receipt = { userId: "user", accountId: "own", localMediaPath: "own/file.pdf" };
  assert.equal(await code.ownsMediaUpload("id", receipt), false);
  await code.rememberMediaUpload("id", receipt);
  assert.equal(await code.ownsMediaUpload("id", receipt), true);
  assert.equal(await code.ownsMediaUpload("id", { ...receipt, userId: "other" }), false);
  assert.equal(await code.ownsMediaUpload("id", { ...receipt, localMediaPath: "own/hidden-chat-file.pdf" }), false);
  assert.equal(await code.ownsMediaUpload("other-id", receipt), false);
});

test("envío: rechaza referencias ajenas antes de enviar a Meta o escribir el mensaje", async () => {
  let sends = 0;
  const route = load("app/api/whatsapp/chats/[chatId]/send/route.ts", {
    ...routeMocks, "@/lib/auth": auth,
    "@/lib/rate-limit": { rateLimit: async () => ({ allowed: true }) },
    "@/lib/whatsapp/chat-visibility": { chatAccessWhere: async () => ({ accountId: "own" }) },
    "@/lib/prisma": { prisma: { wAChat: { findFirst: async () => ({ id: "chat", account: { id: "own" }, remoteJid: "synthetic", firstResponseAt: null }) } } },
    "@/lib/whatsapp/send": { sendWhatsAppMessage: async () => { sends++; } },
    "@/lib/whatsapp/media-upload": { ownsMediaUpload: async () => false },
  });
  const request = value => new Request("http://ludaisca/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await route.POST(request({ type: "text", body: "Test", localMediaPath: "other/private.pdf" }), { params: Promise.resolve({ chatId: "chat" }) })).status, 403);
  assert.equal((await route.POST(request({ type: "text", body: "Test", localMediaPath: "own/private.pdf" }), { params: Promise.resolve({ chatId: "chat" }) })).status, 400);
  assert.equal((await route.POST(request({ type: "document", mediaId: "forged", localMediaPath: "own/private.pdf" }), { params: Promise.resolve({ chatId: "chat" }) })).status, 403);
  assert.equal(sends, 0);
});

test("descarga privada y pública: una asociación antigua a otra cuenta tampoco permite leer el archivo", async () => {
  for (const file of ["app/api/whatsapp/messages/[messageId]/media/route.ts", "app/api/public/chat/[token]/media/[messageId]/route.ts"]) {
    let reads = 0;
    const route = load(file, {
      ...routeMocks, "@/lib/auth": auth,
      "@/lib/rate-limit": { rateLimit: async () => ({ allowed: true }) },
      "@/lib/whatsapp/chat-visibility": { chatAccessWhere: async () => ({ accountId: "own" }) },
      "@/lib/prisma": { prisma: { wAMessage: { findFirst: async () => ({ mediaUrl: "other/private.pdf", chat: { accountId: "own" } }) } } },
      "@/lib/whatsapp/media-store": { resolveAbsolutePath: value => value, mediaReadStream: () => { reads++; } },
      "fs": { promises: { stat: async () => { reads++; return { size: 1 }; } } },
    });
    assert.equal((await route.GET(new Request("http://ludaisca/test"), { params: Promise.resolve({ messageId: "message", token: "token" }) })).status, 404);
    assert.equal(reads, 0);
  }
});

const queueNames = [...fs.readFileSync(new URL("../lib/queue.ts", import.meta.url), "utf8").matchAll(/export const (\w+Queue) =/g)].map(match => match[1]);

test("el inventario real de mantenimiento contiene todas las colas declaradas", () => {
  class FakeQueue { constructor(name) { this.name = name; } }
  const exports = load("lib/queue.ts", { bullmq: { Queue: FakeQueue } });
  assert.equal(exports.ALL_QUEUES.length, queueNames.length);
  for (const name of queueNames) assert.ok(exports.ALL_QUEUES.includes(exports[name]), name);
});

function maintenanceHarness({ active = false, existing = false } = {}) {
  let flag = existing;
  let first = active;
  const events = [];
  const queues = queueNames.map(name => ({ name, pause: async () => events.push(`pause:${name}`), resume: async () => events.push(`resume:${name}`), getActiveCount: async () => { assert.notEqual(name, "restoreQueue"); if (first) { if (first !== "forever") first = false; return 1; } return 0; } }));
  const redis = { exists: async () => Number(flag), set: async () => { flag = true; }, del: async () => { flag = false; events.push("clear-redis"); }, zremrangebyscore: async () => 0, zcard: async () => 0 };
  const code = load("lib/system-maintenance.ts", {
    "@/lib/redis": { getRedisClient: () => redis },
    "@/lib/queue": { ALL_QUEUES: queues, restoreQueue: queues.find(queue => queue.name === "restoreQueue") },
    "@/lib/prisma": { prisma: { systemConfig: { upsert: async () => { events.push("db-state"); }, findUnique: async () => { if (flag) throw new Error("No debe consultar tablas durante restore"); return { maintenanceMode: false }; } } } },
  });
  return { code, events, redis };
}

test("restauración: pausa todas las colas, espera trabajos activos y protege el estado fuera de la BD", async () => {
  const { code, events } = maintenanceHarness({ active: true });
  const start = Date.now();
  await code.enterMaintenanceMode("Test");
  assert.ok(Date.now() - start >= 200, "Debe esperar un ciclo de trabajos activos");
  for (const name of queueNames) assert.ok(events.includes(`pause:${name}`), name);
  assert.equal(await code.isMaintenanceMode(), true);
  await code.exitMaintenanceMode();
  assert.ok(events.indexOf("clear-redis") < events.indexOf("resume:botQueue"));
  assert.equal(await code.isMaintenanceMode(), false);
});

test("restauración fallida: no reanuda negocio tras tocar la BD; un fallo previo sí libera mantenimiento", async () => {
  const failed = maintenanceHarness();
  await failed.code.enterMaintenanceMode("Test");
  await failed.code.handleFailedRestore(true);
  assert.equal(await failed.code.isMaintenanceMode(), true);
  assert.ok(failed.events.includes("resume:restoreQueue"));
  assert.ok(!failed.events.includes("resume:botQueue"));
  assert.ok(!failed.events.includes("clear-redis"));
  const untouched = maintenanceHarness();
  await untouched.code.enterMaintenanceMode("Test");
  await untouched.code.handleFailedRestore(false);
  assert.equal(await untouched.code.isMaintenanceMode(), false);
  assert.ok(untouched.events.includes("resume:botQueue"));
});

test("restauración: aborta antes de tocar datos si los trabajos activos no terminan", async () => {
  const previous = process.env.MAINTENANCE_DRAIN_TIMEOUT_MS;
  process.env.MAINTENANCE_DRAIN_TIMEOUT_MS = "1";
  try {
    const { code, events } = maintenanceHarness({ active: "forever" });
    await assert.rejects(() => code.enterMaintenanceMode("Test"), /operaciones activas/);
    assert.equal(await code.isMaintenanceMode(), false);
    assert.ok(events.includes("resume:botQueue"));
  } finally {
    if (previous === undefined) delete process.env.MAINTENANCE_DRAIN_TIMEOUT_MS;
    else process.env.MAINTENANCE_DRAIN_TIMEOUT_MS = previous;
  }
});

test("API: el gate atómico bloquea una solicitud que compitió con el inicio de mantenimiento", async () => {
  let called = false;
  const { withMaintenanceGuard } = load("lib/maintenance-guard.ts", {
    "@/lib/system-maintenance": { isMaintenanceMode: async () => false },
    "@/lib/redis": { getRedisClient: () => ({ eval: async () => 0 }) },
  });
  const response = await withMaintenanceGuard(async () => { called = true; return new Response("bad"); })();
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("API: libera el lease incluso si falla el handler y no consume ni trunca la subida", async () => {
  let released = 0;
  const { withMaintenanceGuard } = load("lib/maintenance-guard.ts", {
    "@/lib/system-maintenance": { isMaintenanceMode: async () => false },
    "@/lib/redis": { getRedisClient: () => ({ eval: async () => 1, zrem: async () => { released++; } }) },
  });
  const input = new Request("http://ludaisca/test", { method: "POST", body: "streamed-data" });
  const response = await withMaintenanceGuard(async req => new Response(await req.text()))(input);
  assert.equal(await response.text(), "streamed-data");
  await assert.rejects(() => withMaintenanceGuard(async () => { throw new Error("expected"); })(), /expected/);
  assert.equal(released, 2);
});

test("cobertura: todas las API de negocio participan en mantenimiento", () => {
  const root = new URL("../app/api/", import.meta.url);
  const exempt = ["health/route.ts", "system/maintenance-status/route.ts", "auth/[...nextauth]/route.ts"];
  for (const file of fs.readdirSync(root, { recursive: true }).filter(name => name.endsWith("route.ts"))) {
    if (exempt.includes(file) || file.includes("backups/restore/") || file.includes("onboarding/restore/")) continue;
    const source = fs.readFileSync(new URL(file, root), "utf8");
    if (/export (async function|const) (GET|POST|PATCH|PUT|DELETE)/.test(source)) assert.ok(source.includes("withMaintenanceGuard"), file);
  }
});

test("respaldo: recupera RUNNING abandonado, evita duplicado diario y respeta un lock vivo", async () => {
  let locked = false;
  let runs = 0;
  let row = { id: "backup", type: "SCHEDULED", status: "RUNNING", startedAt: new Date("2020-01-01") };
  const redis = { set: async () => { if (locked) return null; locked = true; return "OK"; }, eval: async () => { locked = false; return 1; } };
  const code = load("lib/workers/backup-worker.ts", {
    "@/lib/redis": { getRedisClient: () => redis },
    "@/lib/backup/create-backup": { runBackupPipeline: async () => { runs++; row.status = "COMPLETED"; } },
    "@/lib/backup/retention": { purgeOldBackups: async () => {} },
    "@/lib/prisma": { prisma: { systemBackup: { findFirst: async () => row, findUnique: async () => row, update: async ({ data }) => { row = { ...row, ...data }; return row; } }, user: { findMany: async () => [] } } },
  });
  await code.processScheduledBackupTick();
  assert.equal(runs, 1);
  assert.equal(locked, false);
  await code.processScheduledBackupTick();
  assert.equal(runs, 1);
  locked = true;
  row.status = "RUNNING";
  await code.processScheduledBackupTick();
  assert.equal(runs, 1);
});

const version = new Date("2026-10-01T00:00:00Z");
const delayedJob = { accountId: "account", waChatId: "chat", remoteJid: "untrusted-job-target", chunk: "¡Hola!", botId: "bot", botRevision: version.toISOString(), turnStartedAt: version.toISOString() };
function delayedHarness({ blocked = false, human = false, active = true, changed = false, shared = true } = {}) {
  const sent = [];
  const code = load("lib/workers/bot-send-worker.ts", {
    "@/lib/shared-accounts": { getUserAccountIds: async () => shared ? ["account"] : [] },
    "@/lib/prisma": { prisma: {
      wABot: { findFirst: async () => active ? { userId: "user", updatedAt: changed ? new Date() : version } : null },
      wAAccount: { findUnique: async () => ({ id: "account" }) },
      wAChat: { findFirst: async () => ({ remoteJid: "real-target", contact: { blockedAt: blocked ? new Date() : null } }), update: async () => ({}) },
      wAMessage: { findFirst: async () => human ? { id: "human" } : null, create: async () => ({}) },
    } },
    "@/lib/whatsapp/send": { sendWhatsAppMessage: async (_account, args) => { sent.push(args); return { wamid: "synthetic" }; } },
  });
  return { code, sent };
}

test("mensajes diferidos: bloqueo, intervención humana, cambio de bot o pérdida de acceso cancelan pendientes", async () => {
  for (const state of [{ blocked: true }, { human: true }, { active: false }, { changed: true }, { shared: false }]) {
    const { code, sent } = delayedHarness(state);
    await code.processBotSendJob(delayedJob);
    assert.equal(sent.length, 0, JSON.stringify(state));
  }
  const { code, sent } = delayedHarness();
  await code.processBotSendJob({ ...delayedJob, botId: undefined });
  assert.equal(sent.length, 0);
  await code.processBotSendJob(delayedJob);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "real-target");
});

test("webhook: el sticker conserva id, MIME y se descarga por la cola existente", async () => {
  let received;
  const route = load("app/api/whatsapp/webhook/route.ts", {
    ...routeMocks,
    "@/lib/prisma": { prisma: { wAAccount: { findFirst: async () => ({ id: "account", appSecret: "synthetic" }), update: async () => ({}) } } },
    "@/lib/system-maintenance": { isMaintenanceMode: async () => false },
    "@/lib/crypto": { decrypt: value => value },
    "@/lib/whatsapp/ingest-message": { ingestInboundMessage: async (_account, msg) => { received = msg; } },
  });
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "synthetic" }, contacts: [{ wa_id: "sender", profile: { name: "Test" } }], messages: [{ id: "sticker", from: "sender", type: "sticker", timestamp: "1700000000", sticker: { id: "media-id", mime_type: "image/webp" } }] } }] }] });
  const signature = `sha256=${createHmac("sha256", "synthetic").update(payload).digest("hex")}`;
  assert.equal((await route.POST(new Request("http://ludaisca/test", { method: "POST", body: payload, headers: { "x-hub-signature-256": signature } }))).status, 200);
  assert.equal(received.mediaId, "media-id");
  assert.equal(received.mimeType, "image/webp");
});

test("ingestión: rollback de entrega duplicada revierte el contador y no repite efectos", async () => {
  let unread = 0;
  let persisted = false;
  let queries = 0;
  let downloads = 0;
  const tx = {
    contact: { findUnique: async () => null, upsert: async () => ({ id: "contact", blockedAt: null }) },
    wAChat: { findUnique: async () => null, upsert: async () => { unread++; return { id: "chat", assignedToId: null }; } },
    wAMessage: { create: async () => { if (persisted) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "5.22.0" }); persisted = true; return { id: "message" }; } },
  };
  const db = {
    $transaction: async callback => { const before = unread; try { return await callback(tx); } catch (error) { unread = before; throw error; } },
    wAMessage: { findFirst: async () => (++queries === 3 ? { id: "message" } : null) },
    wAAccount: { update: async () => ({}) }, wABot: { findMany: async () => [] },
  };
  const code = load("lib/whatsapp/ingest-message.ts", {
    "@/lib/prisma": { prisma: db },
    "@/lib/queue": { mediaDownloadQueue: { add: async () => { downloads++; } } },
    "@/lib/whatsapp/auto-assign": { autoAssignChat: async () => null },
    "@/lib/redis": { getRedisClient: () => ({}) },
  });
  const input = { remoteJid: "sender", wamid: "same", timestamp: new Date(), type: "sticker", body: "[sticker]", mediaId: "media", contactName: "Test", isGroup: false };
  await code.ingestInboundMessage("account", input);
  assert.equal(await code.ingestInboundMessage("account", input), null);
  assert.equal(unread, 1);
  assert.equal(downloads, 1);
});

test("seguimiento IA: usa el pipeline seguro y no registra el turno sintético como datos del prospecto", async () => {
  let generation;
  let sent;
  const code = load("lib/whatsapp/lead-recovery.ts", {
    "@/lib/prisma": { prisma: { wAMessage: { findMany: async () => [], create: async () => ({ id: "message" }) }, wAChat: { update: async () => ({}) }, wALeadRecoveryAttempt: { create: async () => ({}) } } },
    "@/lib/ai/settings": { getUserApiKey: async () => "fake" },
    "@/lib/ai/pricing": { estimateCost: async () => 0 },
    "@/lib/whatsapp/bot-tools/generate-reply": { generateBotReply: async args => { generation = args; return { content: "Mensaje seguro", usage: null }; } },
    "@/lib/whatsapp/send": { sendWhatsAppMessage: async (_account, args) => { sent = args.body; return { wamid: "synthetic" }; } },
  });
  await code.sendRecoveryMessage({ id: "chat", remoteJid: "sender" }, { id: "bot" }, { id: "account" }, 1, new Date(), new Date());
  assert.equal(generation.allowTools, false);
  assert.equal(sent, "Mensaje seguro");
});

test("respuesta manual con IA: persiste sondeo y encola mensajes con bot, revisión y turno", async () => {
  let generation;
  let saved;
  const queued = [];
  const now = new Date();
  const code = load("lib/whatsapp/unassigned-lead-reply.ts", {
    "@/lib/shared-accounts": { getUserAccountIds: async () => ["account"] },
    "@/lib/queue": { botSendQueue: { add: async (_name, job) => { queued.push(job); } } },
    "@/lib/prisma": { prisma: {
      wAChat: { findUnique: async () => ({ contact: { blockedAt: null } }) },
      wAMessage: { findFirst: async args => args.where.direction === "INBOUND" ? { id: "inbound", body: "Ana", timestamp: now } : null, count: async () => 0 },
      wABotConversation: { upsert: async () => ({ id: "conversation", qualifiedData: {} }), update: async args => { saved = args.data; } },
      wABotUsage: { create: async () => ({}) },
    } },
    "@/lib/ai/settings": { getUserApiKey: async () => "fake" },
    "@/lib/ai/pricing": { estimateCost: async () => 0 },
    "@/lib/whatsapp/bot-tools/generate-reply": { generateBotReply: async args => { generation = args; return { content: "¡Hola, Ana!", usage: null, qualifiedData: { nombre: "Ana" } }; } },
    "@/lib/whatsapp/send": { sendWhatsAppMessage: async () => { throw new Error("No debe enviar directamente"); } },
  });
  await code.sendManualBotReply({ id: "chat", remoteJid: "sender", account: { id: "account" } }, { id: "bot", updatedAt: version, humanizeEnabled: true, memoryType: "NONE" }, now);
  assert.equal(generation.userContent, "Ana");
  assert.deepEqual(saved.qualifiedData, { nombre: "Ana" });
  assert.equal(queued[0].botId, "bot");
  assert.equal(queued[0].botRevision, version.toISOString());
  assert.equal(queued[0].mode, "manual");
});
