"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { Tabs } from "@/app/components/ui/tabs";
import { useToast } from "@/app/components/ui/toast";
import { ProspectsTab } from "./_prospects-tab";
import { ExecutivesTab } from "./_executives-tab";
import { AccuracyTab } from "./_accuracy-tab";

type Tab = "prospectos" | "precision" | "ejecutivos";

export function CrmEjecutivosView() {
  const { success, error: toastError } = useToast();
  const [tab, setTab] = useState<Tab>("prospectos");
  const [syncing, setSyncing] = useState(false);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/crm-ejecutivos/sync-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al iniciar la sincronización");
      success("Sincronización iniciada — puede tomar unos minutos en reflejarse, según cuántos ejecutivos estés monitoreando.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar la sincronización");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="CRM Ejecutivos"
        description="Prospectos que los ejecutivos trabajan en el otro CRM de la empresa (fuera de WhatsApp), sincronizados aquí de solo lectura y cruzados con los contactos de WAB por teléfono."
        actions={
          <Button icon={RefreshCw} variant="secondary" onClick={handleSyncNow} loading={syncing}>
            Sincronizar ahora
          </Button>
        }
      />

      <Tabs
        items={[
          { value: "prospectos", label: "Prospectos" },
          { value: "precision", label: "Precisión IA" },
          { value: "ejecutivos", label: "Ejecutivos monitoreados" },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {tab === "prospectos" ? <ProspectsTab /> : tab === "precision" ? <AccuracyTab /> : <ExecutivesTab />}
    </div>
  );
}
