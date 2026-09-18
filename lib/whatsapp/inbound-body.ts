// Texto legible para mensajes entrantes que Meta manda como objeto estructurado
// (tarjeta de contacto, ubicación) en vez de texto/media. Se guarda en
// `WAMessage.body`: así se ve en el chat, en el link público, en las
// exportaciones y llega al bot sin cambiar el schema ni la UI.

export interface WebhookSharedContact {
  name?: {
    formatted_name?: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
  emails?: Array<{ email?: string; type?: string }>;
  org?: { company?: string; title?: string };
}

export interface WebhookLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

function contactDisplayName(c: WebhookSharedContact): string {
  const n = c.name;
  const full = [n?.first_name, n?.last_name].filter(Boolean).join(" ");
  return n?.formatted_name?.trim() || full || "Sin nombre";
}

// Una línea por contacto: "👤 Nombre — +52 55 1234 5678, +52 … · correo · Empresa".
export function formatContactsBody(contacts: WebhookSharedContact[] | undefined): string | null {
  if (!contacts || contacts.length === 0) return null;
  return contacts
    .map((c) => {
      const phones = (c.phones ?? []).map((p) => p.phone?.trim() || p.wa_id?.trim()).filter(Boolean);
      const emails = (c.emails ?? []).map((e) => e.email?.trim()).filter(Boolean);
      const company = [c.org?.company, c.org?.title].filter(Boolean).join(", ");
      const parts = [phones.join(", "), emails.join(", "), company].filter(Boolean);
      return `👤 ${contactDisplayName(c)}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
    })
    .join("\n");
}

export function formatLocationBody(loc: WebhookLocation | undefined): string | null {
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") return null;
  const label = [loc.name, loc.address].filter(Boolean).join(" — ");
  const url = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  return `📍 ${label ? `${label}\n` : ""}${url}`;
}
