// ID de lead legible para exportaciones (CSV + Sheets de "Leads calificados"):
// <prefijo de cuenta>-<Contact.leadNumber>. El número lo genera Postgres (ver
// prisma/schema.prisma:Contact.leadNumber); el prefijo es de WAAccount.leadIdPrefix,
// editable, con fallback aquí para cuentas que aún no lo tienen configurado.

const DIACRITICS = /[\u0300-\u036f]/g;

export function suggestLeadPrefix(accountName: string): string {
  const letters = accountName
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return letters.slice(0, 3) || "LEAD";
}

export function formatLeadId(prefix: string | null, accountName: string, leadNumber: string | null): string {
  if (!leadNumber) return "";
  return `${prefix ?? suggestLeadPrefix(accountName)}-${leadNumber}`;
}
