import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { prisma } from "@/lib/prisma";
import { loadBaileysAuthState, deleteDbAuthState } from "./auth-store";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-message";

const logger = pino({ level: "warn" });

interface ConnectionEntry {
  sock: WASocket;
  qr: string | null;
  status: "PENDING" | "CONNECTED" | "ERROR";
}

const connections = new Map<string, ConnectionEntry>();

export function getConnectionInfo(accountId: string) {
  const entry = connections.get(accountId);
  if (!entry) return null;
  return { qr: entry.qr, status: entry.status };
}

export function getActiveSocket(accountId: string): WASocket | null {
  return connections.get(accountId)?.sock ?? null;
}

export async function stopBaileysConnection(accountId: string) {
  const entry = connections.get(accountId);
  if (entry) {
    entry.sock.end(undefined);
    connections.delete(accountId);
  }
}

function extractTextBody(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return "[mensaje no compatible]";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    "[mensaje no compatible]"
  );
}

export async function startBaileysConnection(accountId: string): Promise<void> {
  await stopBaileysConnection(accountId);

  const { state, saveCreds } = await loadBaileysAuthState(accountId);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: ["WAB (dev)", "Chrome", "1.0.0"],
  });

  connections.set(accountId, { sock, qr: null, status: "PENDING" });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const entry = connections.get(accountId);
    if (!entry) return;

    if (update.qr) {
      entry.qr = update.qr;
      entry.status = "PENDING";
    }

    if (update.connection === "open") {
      entry.qr = null;
      entry.status = "CONNECTED";
      const jid = sock.user?.id ?? null;
      const phoneNumber = jid ? jid.split(":")[0].split("@")[0] : null;
      await prisma.wAAccount.update({
        where: { id: accountId },
        data: { status: "CONNECTED", phoneNumber, errorMessage: null, lastActivity: new Date() },
      });
    }

    if (update.connection === "close") {
      const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        entry.status = "ERROR";
        connections.delete(accountId);
        await deleteDbAuthState(accountId);
        await prisma.wAAccount.update({
          where: { id: accountId },
          data: { status: "DISCONNECTED", errorMessage: "Sesión cerrada desde el teléfono. Vuelve a escanear el QR." },
        });
        return;
      }

      // Any other close reason: reconnect (network hiccup, restart required, etc.)
      connections.delete(accountId);
      setTimeout(() => {
        startBaileysConnection(accountId).catch((err) => {
          console.error(`[baileys] Reconnect failed for account ${accountId}:`, err);
        });
      }, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.key.remoteJid) continue;

      await ingestInboundMessage(accountId, {
        remoteJid: msg.key.remoteJid,
        wamid: msg.key.id ?? null,
        timestamp: new Date(Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000),
        type: "text",
        body: extractTextBody(msg),
        contactName: msg.pushName ?? msg.key.remoteJid,
        isGroup: msg.key.remoteJid.endsWith("@g.us"),
      }).catch((err) => {
        console.error(`[baileys] Failed to ingest message for account ${accountId}:`, err);
      });
    }
  });
}

export async function reconnectAllBaileysAccounts() {
  const accounts = await prisma.wAAccount.findMany({
    where: { channel: "BAILEYS", status: "CONNECTED" },
    select: { id: true },
  });

  for (const account of accounts) {
    startBaileysConnection(account.id).catch((err) => {
      console.error(`[baileys] Failed to reconnect account ${account.id}:`, err);
    });
  }
}
