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

export interface AppShellProps {
  nav: NavItem[];
  accent?: "accent" | "danger";
  bottomActions?: React.ReactNode;
  logoArea?: React.ReactNode;
  headerRight?: React.ReactNode;
  hideUserDropdown?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}

function activeClass(accent: "accent" | "danger") {
  return accent === "accent"
    ? "bg-accent/10 text-accent"
    : "bg-danger-bg text-danger";
}

function SidebarContent({
  nav,
  accent = "accent",
  bottomActions,
  logoArea,
  collapsed,
  onClose,
}: Pick<AppShellProps, "nav" | "accent" | "bottomActions"> & {
  logoArea?: React.ReactNode;
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className={cn("flex flex-col h-full transition-all", collapsed ? "items-center px-2" : "")}>
      <div className={cn("shrink-0 transition-all", collapsed ? "px-0 py-5" : "px-4 py-5")}>
        {logoArea ?? (
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent font-bold text-sm shrink-0">
              W
            </div>
            {!collapsed && (
              <span className="text-base font-semibold tracking-tight whitespace-nowrap">
                WAB
              </span>
            )}
          </Link>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto", collapsed ? "px-1" : "px-3")}>
        <ul className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center rounded-lg text-sm font-medium transition-colors",
                    collapsed ? "justify-center w-10 h-10" : "gap-3 px-3 py-2.5",
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
          })}
        </ul>
      </nav>

      <div className={cn(
        "shrink-0 border-t border-border transition-all",
        collapsed ? "px-1 pt-3 mt-1 pb-4" : "px-3 pt-3 mt-1 pb-4"
      )}>
        {!collapsed && bottomActions}
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          title={collapsed ? "Cerrar sesión" : undefined}
          className={cn(
            "flex items-center text-sm font-medium text-muted transition-colors hover:bg-surface-light hover:text-danger rounded-lg",
            collapsed ? "justify-center w-10 h-10" : "gap-3 w-full px-3 py-2.5"
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
  headerRight,
  hideUserDropdown = false,
  collapsible = false,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="flex min-h-svh bg-background">
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
          collapsed={collapsed}
        />
      </aside>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" width="w-64">
        <SidebarContent
          nav={nav}
          accent={accent}
          bottomActions={bottomActions}
          logoArea={logoArea}
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

        <main className="flex-1 p-4 md:p-6 lg:p-8 animate-fade-in">
          <Breadcrumb />
          {children}
        </main>
      </div>
    </div>
  );
}
