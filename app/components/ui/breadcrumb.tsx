"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Panel",
  estadisticas: "Estadísticas",
  whatsapp: "WhatsApp",
  bots: "Bots IA",
  campanas: "Campañas",
  chat: "Chats",
  cuentas: "Cuentas",
  calificadores: "Calificadores de Leads",
  plantillas: "Plantillas",
  usuarios: "Usuarios",
  configuracion: "Configuración",
  ia: "Inteligencia Artificial",
  contactos: "Contactos",
  nueva: "Nueva",
  nuevo: "Nuevo",
  "asistente-ia": "Asistente IA",
  auditoria: "Auditoría",
  backups: "Backups",
  "crm-ejecutivos": "CRM Ejecutivos",
  exportaciones: "Exportaciones",
  reportes: "Reportes",
  // "automatizacion" tiene su propia página (/whatsapp/campanas/automatizacion,
  // ver page.tsx ahí) — antes era una pestaña client-side sin ruta propia, lo
  // que dejaba este segmento clicable hacia una URL sin page.tsx y Next.js
  // caía al sibling dinámico campanas/[id]/page.tsx ("Campaña no encontrada").
  // Ahora que tiene página real, es un segmento navegable normal — mismo
  // nombre que el ítem de sidebar/PageHeader para no decir dos cosas distintas.
  automatizacion: "Facebook Ads",
};

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) return null;

  function label(seg: string) {
    return LABELS[seg]
      ?? (seg.length > 20 ? "Detalle" : seg.charAt(0).toUpperCase() + seg.slice(1));
  }

  const crumbs = segments.map((seg, i) => ({
    href:   "/" + segments.slice(0, i + 1).join("/"),
    label:  label(seg),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-darker">
      <Link
        href="/dashboard"
        className="flex items-center hover:text-foreground transition-colors"
        aria-label="Inicio"
      >
        <Home size={12} />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight size={11} className="text-border" />
          {crumb.isLast ? (
            <span className="text-foreground font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
