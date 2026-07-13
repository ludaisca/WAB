"use client";

import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Settings,
  MessageSquare,
  Bot,
  Megaphone,
  Users,
  BarChart3,
  Database,
  FileText,
  Contact,
  Phone,
} from "lucide-react";
import { AppShell, type NavItem, type NavGroup } from "@/app/components/ui/app-shell";
import { NotificationBell } from "@/app/components/ui/notification-bell";

export function DashboardShell({
  children,
  businessName,
}: {
  children: React.ReactNode;
  businessName?: string | null;
}) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "admin";
  const isEjecutivo = role === "ejecutivo";

  const NAV: (NavItem | NavGroup)[] = isEjecutivo
    ? [
        {
          title: "Mensajería",
          items: [
            { href: "/whatsapp/chat",      label: "Chats",           icon: MessageSquare },
            { href: "/whatsapp/contactos", label: "Contactos",       icon: Contact },
          ],
        },
        {
          title: "Ajustes",
          items: [
            { href: "/configuracion",      label: "Configuración",   icon: Settings, exact: true },
          ],
        },
      ]
    : [
        {
          title: "Análisis",
          items: [
            { href: "/dashboard",               label: "Panel",            icon: LayoutDashboard, exact: true },
            { href: "/estadisticas",            label: "Estadísticas",     icon: BarChart3, exact: true },
          ],
        },
        {
          title: "Mensajería",
          items: [
            { href: "/whatsapp/chat",           label: "Bandeja de Chats", icon: MessageSquare },
            { href: "/whatsapp/contactos",      label: "Contactos",        icon: Contact },
          ],
        },
        {
          title: "Automatización",
          items: [
            { href: "/whatsapp/bots",           label: "Bots IA",          icon: Bot },
            { href: "/whatsapp/conocimiento",   label: "Base de Conocimiento", icon: Database },
          ],
        },
        {
          title: "Canales",
          items: [
            { href: "/whatsapp",                label: "Cuentas WhatsApp", icon: Phone, exact: true },
          ],
        },
        {
          title: "Difusión",
          items: [
            { href: "/whatsapp/plantillas",     label: "Plantillas",       icon: FileText },
            { href: "/whatsapp/campanas",       label: "Campañas Masivas", icon: Megaphone },
          ],
        },
        {
          title: "Ajustes",
          items: [
            ...(isAdmin
              ? [{ href: "/usuarios" as const,  label: "Usuarios",         icon: Users as React.ElementType, exact: true }]
              : []),
            { href: "/configuracion",           label: "Configuración",    icon: Settings, exact: true },
          ],
        },
      ];

  return (
    <AppShell nav={NAV} accent="accent" collapsible brand={businessName || undefined} headerRight={<NotificationBell />}>
      {children}
    </AppShell>
  );
}
