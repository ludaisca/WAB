import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import load from "./helpers/load-typescript.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const url = process.env.TEST_DATABASE_URL;

test("PostgreSQL aislado: entregas simultáneas del mismo wamid dejan un solo mensaje y un solo incremento", { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, "wab-review-regression-db", "Solo se permite el contenedor desechable de pruebas");
  assert.equal(target.pathname, "/wab_regression");
  const db = new PrismaClient({ datasources: { db: { url } } });
  const code = load("lib/whatsapp/ingest-message.ts", {
    "@/lib/prisma": { prisma: db },
    "@/lib/queue": {},
    "@/lib/whatsapp/auto-assign": { autoAssignChat: async () => null },
    "@/lib/redis": { getRedisClient: () => ({}) },
  });
  let user;
  try {
    user = await db.user.create({ data: { email: `test-${Date.now()}@example.invalid`, role: "admin" } });
    const account = await db.wAAccount.create({ data: { userId: user.id, name: "Regression only" } });
    const input = { remoteJid: "synthetic", wamid: "duplicate", timestamp: new Date(), type: "text", body: "Hola", contactName: "Test", isGroup: false };
    await Promise.all(Array.from({ length: 6 }, () => code.ingestInboundMessage(account.id, input)));
    const chat = await db.wAChat.findFirstOrThrow({ where: { accountId: account.id } });
    assert.equal(await db.wAMessage.count({ where: { chatId: chat.id } }), 1);
    assert.equal(chat.unreadCount, 1);
    await Promise.all(["next-one", "next-two"].map(wamid => code.ingestInboundMessage(account.id, { ...input, wamid })));
    assert.equal(await db.wAMessage.count({ where: { chatId: chat.id } }), 3);
    assert.equal((await db.wAChat.findUniqueOrThrow({ where: { id: chat.id } })).unreadCount, 3);
  } finally {
    if (user) await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
