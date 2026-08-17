// Cruce de teléfono entre el CRM externo (números nacionales de 10 dígitos,
// sin código de país — ver el `phone` crudo de get-all-prospects) y
// Contact.remoteJid de WAB (JID de WhatsApp, con código de país + a veces el
// "1" de móvil que Meta antepone para números MX: 52 1 XXXXXXXXXX). No hay
// forma barata de resolver el formato canónico exacto sin llamar a la Graph
// API por cada número, así que el cruce usa los ÚLTIMOS 10 DÍGITOS como
// clave — cubre el caso común (números MX de 10 dígitos) sin más vueltas.
// Igual que lib/workers/campaign-worker.ts:normalizePhone, deliberadamente
// una función chica duplicable en vez de una utilidad "central" — mismo
// criterio que el resto del repo para este tipo de helper de una línea.
const KEY_LENGTH = 10;

export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-KEY_LENGTH);
}

// Contact.remoteJid trae sufijo "@s.whatsapp.net" (o similar) — se descarta
// antes de quedarse con los dígitos, mismo criterio que campaign-worker.ts.
export function phoneKeyFromRemoteJid(remoteJid: string): string {
  return phoneKey(remoteJid.replace(/@.*$/, ""));
}
