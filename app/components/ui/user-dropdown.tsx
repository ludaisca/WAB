"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { Settings, LogOut, ChevronDown } from "lucide-react";

export function UserDropdown() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!session?.user) return null;

  const name    = session.user.name ?? session.user.email ?? "Usuario";
  const email   = session.user.email ?? "";
  const initials = name.slice(0, 2).toUpperCase();
  const shortName = name.split(/\s+/).slice(0, 2).join(" ");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-light transition-colors"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent font-bold text-xs shrink-0 select-none">
          {initials}
        </div>
        <span className="hidden md:block text-sm font-medium max-w-[130px] truncate">{shortName}</span>
        <ChevronDown
          size={14}
          className={`hidden md:block text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border bg-surface shadow-lg z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-on-accent font-bold text-sm shrink-0 select-none">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{name}</p>
                  <p className="text-xs text-muted-darker truncate">{email}</p>
                </div>
              </div>
            </div>

            <div className="py-1">
              <Link
                href="/configuracion"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-light transition-colors"
              >
                <Settings size={15} className="text-muted shrink-0" />
                Configuración
              </Link>
            </div>

            <div className="border-t border-border py-1">
              <button
                // redirect: false + navegación relativa — ver app-shell.tsx: la
                // redirección del servidor usa el origen interno del contenedor.
                onClick={async () => {
                  await signOut({ redirect: false });
                  window.location.href = "/login";
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted hover:bg-surface-light hover:text-foreground transition-colors"
              >
                <LogOut size={15} className="shrink-0" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
