import { redirect } from "next/navigation";

// El hub intermedio se eliminó (2026-07): sus KPIs duplicaban el Panel y su
// lista de cuentas duplicaba /whatsapp/cuentas. La ruta se conserva solo como
// redirect para no romper links/bookmarks existentes.
export default function WhatsAppHubRedirect() {
  redirect("/whatsapp/cuentas");
}
