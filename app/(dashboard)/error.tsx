"use client";

import { RefreshCw, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { Banner } from "@/app/components/ui/banner";
import { Button } from "@/app/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="max-w-2xl mx-auto py-10 space-y-6">
    <PageHeader title="No pudimos cargar esta vista" description="Puedes intentar de nuevo sin cerrar tu sesión." />
    <Banner tone="warning" title="La información no está disponible temporalmente">Tus borradores de chat se conservan mientras mantengas abierta esta pestaña.</Banner>
    <div className="flex flex-wrap gap-3">
      <Button icon={RefreshCw} onClick={reset}>Volver a intentar</Button>
      <Button icon={ArrowLeft} variant="secondary" href="/whatsapp/chat">Ir a chats</Button>
    </div>
  </div>;
}
