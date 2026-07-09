import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";

interface StoredAuth {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
}

// Persists Baileys' auth state (creds + Signal protocol keys) as a single JSON
// blob in Postgres instead of the filesystem, so pairing survives container
// recreation without needing a dedicated Docker volume.
export async function loadBaileysAuthState(waAccountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const existing = await prisma.wABaileysSession.findUnique({ where: { waAccountId } });

  const stored: StoredAuth = existing
    ? (JSON.parse(JSON.stringify(existing.authState), BufferJSON.reviver) as StoredAuth)
    : { creds: initAuthCreds(), keys: {} };

  const creds = stored.creds;
  const keyData = stored.keys;

  async function persist() {
    const serialized = JSON.parse(JSON.stringify({ creds, keys: keyData }, BufferJSON.replacer));
    await prisma.wABaileysSession.upsert({
      where: { waAccountId },
      create: { waAccountId, authState: serialized },
      update: { authState: serialized },
    });
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = keyData[type]?.[id];
            if (value && type === "app-state-sync-key") {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            }
            if (value !== undefined) {
              result[id] = value as SignalDataTypeMap[T];
            }
          }
          return result;
        },
        set: async (data) => {
          for (const type in data) {
            keyData[type] = keyData[type] ?? {};
            const typeData = data[type as keyof typeof data] as Record<string, unknown> | undefined;
            for (const id in typeData) {
              const value = typeData[id];
              if (value) keyData[type][id] = value;
              else delete keyData[type][id];
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}

export async function deleteDbAuthState(waAccountId: string) {
  await prisma.wABaileysSession.deleteMany({ where: { waAccountId } });
}
