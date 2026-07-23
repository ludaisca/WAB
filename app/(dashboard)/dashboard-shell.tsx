"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Settings,
  MessageSquare,
  Bot,
  Megaphone,
  Users,
  BarChart3,
  FileText,
  Contact,
  Phone,
  Target,
  Sparkles,
  DatabaseBackup,
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

  // Visible para TODOS los roles (no solo admin) — un ejecutivo viendo el
  // chat durante una restauración también debe saber por qué los datos
  // pueden verse inconsistentes momentáneamente. Poll ligero, mismo cadence
  // que la campanita de notificaciones.
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    const check = () => {
      fetch("/api/system/maintenance-status")
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setMaintenanceMode(!!d.maintenanceMode); })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 25000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.user?.id]);

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
            ...(isAdmin ? [{ href: "/whatsapp/contactos" as const, label: "Contactos", icon: Contact as React.ElementType }] : []),
          ],
        },
        {
          title: "Automatización",
          items: [
            ...(isAdmin ? [{ href: "/whatsapp/bots" as const, label: "Bots IA", icon: Bot as React.ElementType }] : []),
            { href: "/whatsapp/calificadores",  label: "Calificadores de Leads", icon: Target },
          ],
        },
        ...(isAdmin
          ? [{
              title: "Asistente",
              items: [{ href: "/asistente-ia" as const, label: "Asistente IA", icon: Sparkles as React.ElementType }],
            }]
          : []),
        {
          title: "Canales",
          items: [
            { href: "/whatsapp/cuentas",        label: "Cuentas WhatsApp", icon: Phone },
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
            ...(isAdmin
              ? [{ href: "/configuracion/backups" as const, label: "Backups", icon: DatabaseBackup as React.ElementType }]
              : []),
            { href: "/configuracion",           label: "Configuración",    icon: Settings, exact: true },
          ],
        },
      ];

  return (
    <>
      {maintenanceMode && (
        <div className="fixed top-0 inset-x-0 z-[60] bg-warning text-on-accent text-center text-xs sm:text-sm font-medium py-1.5 px-4">
          Sistema en mantenimiento: restaurando un respaldo. Los datos pueden verse incompletos hasta que termine.
        </div>
      )}
      <AppShell nav={NAV} accent="accent" collapsible brand={businessName || undefined} headerRight={<NotificationBell />}>
        {children}
      </AppShell>
    </>
  );
}
