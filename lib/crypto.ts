import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted.toString("hex")
  );
}

export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Un fallo de descifrado por ENCRYPTION_KEY distinta (p. ej. tras restaurar un
// respaldo de otra instancia) salía como "Unsupported state or unable to
// authenticate data", incomprensible para el operador. Se traduce a un mensaje
// accionable; devuelve null cuando el error no es de cifrado.
export function describeDecryptError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /unable to authenticate data|Unsupported state|Invalid encrypted data format/i.test(message) ||
    /ENCRYPTION_KEY must be a 64-character hex string/i.test(message)
  ) {
    return "No se pudieron descifrar las credenciales de esta cuenta: la ENCRYPTION_KEY actual no coincide con la que las cifró. Vuelve a conectar la cuenta o restaura el respaldo con la llave original.";
  }
  return null;
}
