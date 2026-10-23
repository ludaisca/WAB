import { createHash } from "node:crypto";

// No se guarda el hash de contraseña en la sesión: solo una revisión opaca
// que cambia al modificar contraseña o rol, sin columnas nuevas en la BD.
export function credentialRevision(password: string, role: string): string {
  return createHash("sha256").update(`${password}\0${role}`).digest("hex");
}
