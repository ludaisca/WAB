"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer } from "./drawer";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { UserDropdown } from "./user-dropdown";
import { Breadcrumb } from "./breadcrumb";
import { cn } from "./cn";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export interface AppShellProps {
  nav: (NavItem | NavGroup)[];
  accent?: "accent" | "danger";
  bottomActions?: React.ReactNode;
  logoArea?: React.ReactNode;
  brand?: string;
  headerRight?: React.ReactNode;
  hideUserDropdown?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}

function activeClass(accent: "accent" | "danger") {
  return accent === "accent"
    ? "bg-accent/10 text-accent font-semibold"
    : "bg-danger-bg text-danger font-semibold";
}

function SidebarContent({
  nav,
  accent = "accent",
  bottomActions,
  logoArea,
  brand = "WAB",
  collapsed,
  onClose,
}: Pick<AppShellProps, "nav" | "accent" | "bottomActions" | "brand"> & {
  logoArea?: React.ReactNode;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  const renderLink = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");

    return (
      <li key={item.href} className="relative w-full">
        {active && (
          <span
            className={cn(
              "absolute left-0 top-2 bottom-2 w-1 rounded-r-md",
              accent === "accent" ? "bg-accent" : "bg-danger"
            )}
          />
        )}
        <Link
          href={item.href}
          onClick={onClose}
          title={collapsed ? item.label : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm font-medium transition-all duration-150",
            collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-3 py-2.5",
            active
              ? activeClass(accent ?? "accent")
              : "text-muted hover:bg-surface-light hover:text-foreground"
          )}
        >
          <Icon size={18} className="shrink-0" />
          {!collapsed && item.label}
        </Link>
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col h-full transition-all", collapsed ? "items-center px-2" : "")}>
      <div className={cn("shrink-0 transition-all", collapsed ? "px-0 py-5" : "px-4 py-5")}>
        {logoArea ?? (
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent font-bold text-sm shrink-0">
              {brand.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <span className="text-base font-semibold tracking-tight whitespace-nowrap truncate">
                {brand}
              </span>
            )}
          </Link>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto w-full", collapsed ? "px-1" : "px-3")}>
        <div className="flex flex-col gap-5 w-full">
          {nav.map((groupOrItem, index) => {
            const isGroup = "items" in groupOrItem;
            if (isGroup) {
              const group = groupOrItem as NavGroup;
              if (group.items.length === 0) return null;
              return (
                <div key={group.title || index} className="flex flex-col gap-1 w-full">
                  {!collapsed && group.title && (
                    <div className="px-3 text-[10px] font-bold text-muted-darker tracking-wider uppercase mb-1">
                      {group.title}
                    </div>
                  )}
                  <ul className="flex flex-col gap-0.5 w-full">
                    {group.items.map(renderLink)}
                  </ul>
                </div>
              );
            } else {
              const item = groupOrItem as NavItem;
              return (
                <ul key={item.href} className="flex flex-col gap-0.5 w-full">
                  {renderLink(item)}
                </ul>
              );
            }
          })}
        </div>
      </nav>

      <div className={cn(
        "shrink-0 border-t border-border transition-all w-full",
        collapsed ? "px-1 pt-3 mt-1 pb-4" : "px-3 pt-3 mt-1 pb-4"
      )}>
        {!collapsed && bottomActions}
        <button
          // redirect: false + navegación relativa: la URL absoluta que arma el
          // servidor usa el origen interno del contenedor (0.0.0.0:5000) y
          // mandaba al usuario fuera de la app tras cerrar sesión.
          onClick={async () => {
            await signOut({ redirect: false });
            window.location.href = "/login";
          }}
          title={collapsed ? "Cerrar sesión" : undefined}
          className={cn(
            "flex items-center text-sm font-medium text-muted transition-colors hover:bg-surface-light hover:text-danger rounded-lg",
            collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 w-full px-3 py-2.5"
          )}
        >
          <LogOut size={18} />
          {!collapsed && "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}

export function AppShell({
  nav,
  accent = "accent",
  bottomActions,
  logoArea,
  brand,
  headerRight,
  hideUserDropdown = false,
  collapsible = false,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Chat is a dense, WhatsApp-Web-style inbox that manages its own internal
  // scrolling panes — the standard page chrome (breadcrumb + p-8 padding)
  // just eats space it needs, so this route gets a full-bleed shell instead.
  const pathname = usePathname();
  const fullBleed = pathname.startsWith("/whatsapp/chat");

  useEffect(() => {
    if (!collapsible) return;
    const stored = localStorage.getItem("sidebar-collapsed");
    // Deliberately set state after mount: localStorage is unavailable during
    // SSR, so reading it during render would mismatch the server-rendered
    // markup. Reading it post-hydration in an effect is the correct fix here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "true") setCollapsed(true);
  }, [collapsible]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  return (
    <div className={cn("flex bg-background", fullBleed ? "h-svh" : "min-h-svh")}>
      <aside
        className={cn(
          "hidden md:flex border-r border-border bg-surface flex-col shrink-0 transition-all duration-200",
          collapsed ? "w-16" : "w-60 lg:w-64"
        )}
      >
        <SidebarContent
          nav={nav}
          accent={accent}
          bottomActions={bottomActions}
          logoArea={logoArea}
          brand={brand}
          collapsed={collapsed}
        />
      </aside>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" width="w-64">
        <SidebarContent
          nav={nav}
          accent={accent}
          bottomActions={bottomActions}
          logoArea={logoArea}
          brand={brand}
          onClose={() => setDrawerOpen(false)}
        />
      </Drawer>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6 shrink-0 bg-surface">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden text-foreground hover:text-muted transition-colors"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>

          {collapsible && (
            <button
              onClick={toggleCollapsed}
              className="hidden md:flex text-muted-darker hover:text-foreground transition-colors p-1 rounded-md"
              aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          )}

          <div className="md:hidden flex-1 flex items-center">
            <Link href="/dashboard" className="flex items-center gap-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-on-accent font-bold text-xs">
                W
              </div>
              <span className="text-sm font-semibold tracking-tight">
                WAB
              </span>
            </Link>
          </div>

          <div className="hidden md:block flex-1" />

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            {headerRight}
            {!hideUserDropdown && <UserDropdown />}
          </div>
        </header>

        <main
          className={cn(
            "flex-1 animate-fade-in",
            fullBleed ? "flex flex-col min-h-0 overflow-hidden" : "p-4 md:p-6 lg:p-8"
          )}
        >
          {!fullBleed && <Breadcrumb />}
          {children}
        </main>
      </div>
    </div>
  );
}
