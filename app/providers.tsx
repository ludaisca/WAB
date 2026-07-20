"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/app/components/ui/toast";
import { MotionProvider } from "@/app/components/motion-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <MotionProvider>{children}</MotionProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
