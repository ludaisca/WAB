// Compartido por cualquier flujo que escriba Contact.name/WAChat.name desde una
// fuente externa (webhook de Meta, CSV de campaña, columna de una hoja de
// Sheets) — evita que un nombre real ya guardado se pise con un fallback (el
// número de teléfono), sin bloquear que un fallback se actualice a un nombre
// real cuando llega uno.

export function phoneFromJid(remoteJid: string): string {
  return remoteJid.split("@")[0];
}

export function isFallbackName(name: string | null | undefined, remoteJid: string): boolean {
  if (!name) return true;
  return name === remoteJid || name === phoneFromJid(remoteJid);
}

// true si el nombre entrante debe escribirse sobre el existente: o trae un
// nombre real (no es la misma cosa que un fallback), o lo que había guardado
// era en sí mismo un fallback y por lo tanto no hay nada real que proteger.
export function shouldUpdateName(
  incomingName: string | null | undefined,
  existingName: string | null | undefined,
  remoteJid: string
): boolean {
  return !isFallbackName(incomingName, remoteJid) || isFallbackName(existingName, remoteJid);
}
