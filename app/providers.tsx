"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/app/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </SessionProvider>
  );
}
