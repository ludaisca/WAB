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
} from "lucide-react";
import { AppShell, type NavItem } from "@/app/components/ui/app-shell";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "admin";
  const isEjecutivo = role === "ejecutivo";

  const NAV: NavItem[] = isEjecutivo
    ? [
        { href: "/whatsapp/chat",    label: "Chats",           icon: MessageSquare },
        { href: "/configuracion",    label: "Configuración",   icon: Settings, exact: true },
      ]
    : [
        { href: "/dashboard",               label: "Panel",            icon: LayoutDashboard, exact: true },
        { href: "/estadisticas",            label: "Estadísticas",     icon: BarChart3, exact: true },
        { href: "/whatsapp",                label: "WhatsApp",         icon: MessageSquare },
        { href: "/whatsapp/bots",           label: "Bots IA",          icon: Bot },
        { href: "/whatsapp/conocimiento",   label: "Conocimiento",     icon: Database },
        { href: "/whatsapp/campanas",       label: "Campañas",         icon: Megaphone },
        ...(isAdmin
          ? [{ href: "/usuarios" as const, label: "Usuarios", icon: Users as React.ElementType, exact: true }]
          : []),
        { href: "/configuracion",           label: "Configuración",    icon: Settings, exact: true },
      ];

  return (
    <AppShell nav={NAV} accent="accent" collapsible>
      {children}
    </AppShell>
  );
}
