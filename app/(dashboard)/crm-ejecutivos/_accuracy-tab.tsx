"use client";

import { useState, useEffect, useCallback } from "react";
import { Target } from "lucide-react";
import { SectionHeader } from "@/app/components/ui/section-header";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Select } from "@/app/components/ui/select";
import { DonutChart } from "@/app/components/ui/chart";
import { aiLabelText } from "@/lib/crm-ejecutivos/ai-labels";

interface ExecutiveOption { id: string; label: string; }

interface AccuracyRow {
  aiLabel: string;
  cliente: number;
  oportunidad: number;
  rechazado: number;
  descartado: number;
  en_proceso: number;
  total: number;
  conversionRate: number | null;
}

interface ChannelMixEntry {
  action: string;
  count: number;
}

interface TimeToCloseStats {
  count: number;
  avgDays: number | null;
  medianDays: number | null;
}

interface AccuracyData {
  totalMatched: number;
  matrix: AccuracyRow[];
  overallConversionRate: number | null;
  trackingAnalytics: {
    channelMix: ChannelMixEntry[];
    timeToClose: TimeToCloseStats;
  };
}

function days(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} días`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function AccuracyTab() {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [executives, setExecutives] = useState<ExecutiveOption[]>([]);
  const [executiveFilter, setExecutiveFilter] = useState("all");

  useEffect(() => {
    fetch("/api/crm-ejecutivos/tracked-executives")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setExecutives(d.map((e) => ({ id: e.id, label: e.label }))); })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (executiveFilter !== "all") params.set("trackedExecutiveId", executiveFilter);
      const res = await fetch(`/api/crm-ejecutivos/accuracy?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al cargar la comparativa");
      setData(json);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar la comparativa");
    } finally {
      setLoading(false);
    }
  }, [executiveFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filtro-cambiado
    fetchData();
  }, [fetchData]);

  const kpiItems: KpiItem[] = [
    { label: "Leads cruzados", value: String(data?.totalMatched ?? 0), hint: "con match en WAB" },
    { label: "Conversión general", value: pct(data?.overallConversionRate ?? null), hint: "oportunidad o cliente, entre lo ya resuelto" },
  ];

  const columns: TableColumn<AccuracyRow>[] = [
    {
      key: "aiLabel",
      header: "Predicción IA (WAB)",
      render: (r) => <span className="font-medium">{aiLabelText(r.aiLabel)}</span>,
    },
    {
      key: "cliente",
      header: "Cliente",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.cliente,
    },
    {
      key: "oportunidad",
      header: "Oportunidad",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.oportunidad,
      hideBelow: "sm",
    },
    {
      key: "rechazado",
      header: "Rechazado",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.rechazado,
      hideBelow: "sm",
    },
    {
      key: "descartado",
      header: "Descartado",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.descartado,
      hideBelow: "md",
    },
    {
      key: "en_proceso",
      header: "En proceso",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.en_proceso,
      hideBelow: "md",
    },
    {
      key: "total",
      header: "Total",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => r.total,
    },
    {
      key: "conversionRate",
      header: "% Conversión",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-sm",
      render: (r) => pct(r.conversionRate),
    },
  ];

  return (
    <div className="space-y-10">
      <div>
        <SectionHeader
          eyebrow="CRM Ejecutivos"
          title="Precisión de la IA"
          action={
            <Select
              value={executiveFilter}
              onChange={(e) => setExecutiveFilter(e.target.value)}
              className="min-w-[180px]"
            >
              <option value="all">Todos los ejecutivos</option>
              {executives.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </Select>
          }
        />
        <p className="mt-2 text-sm text-muted-darker max-w-2xl">
          Compara la etiqueta que la IA de WAB le puso a cada lead contra el
          resultado real registrado por el ejecutivo en el CRM externo — solo
          cuenta prospectos con match confirmado en WAB. &quot;% Conversión&quot;
          es (cliente + oportunidad) sobre lo ya resuelto (excluye &quot;en
          proceso&quot;, que todavía no tiene desenlace). Cuando un teléfono
          aparece en más de una cuenta de WhatsApp, se usa la conversación con
          actividad más reciente — revisa el detalle de un prospecto en la
          pestaña Prospectos para ver todas las cuentas donde aparece.
        </p>
        <div className="mt-4">
          <KpiStrip items={kpiItems} size="compact" />
        </div>
        <div className="mt-6">
          <Table
            columns={columns}
            rows={data?.matrix ?? []}
            rowKey={(r) => r.aiLabel}
            loading={loading}
            error={fetchError}
            onRetry={fetchData}
            emptyIcon={Target}
            emptyTitle="Sin datos todavía"
            emptyDescription="Necesitas prospectos con match en WAB para ver la comparativa — revisa la pestaña Prospectos."
          />
        </div>
      </div>

      <div>
        <SectionHeader
          eyebrow="CRM Ejecutivos"
          title="Operación del CRM externo"
        />
        <p className="mt-2 text-sm text-muted-darker max-w-2xl">
          Del historial de seguimientos que los ejecutivos registran (no
          depende de match en WAB) — mezcla de canales usados y qué tan
          rápido un prospecto se vuelve cliente.
        </p>
        <div className="mt-4 grid gap-8 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-darker mb-3">Canal de seguimiento</p>
            {(data?.trackingAnalytics.channelMix.length ?? 0) > 0 ? (
              <DonutChart
                data={(data?.trackingAnalytics.channelMix ?? []).map((c) => ({ name: c.action, value: c.count }))}
                height={160}
                totalLabel="seguimientos"
                fold={false}
              />
            ) : (
              <p className="text-sm text-muted-darker">Sin historial de seguimientos sincronizado todavía.</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-darker mb-3">Velocidad de cierre (primer contacto → cliente)</p>
            <KpiStrip
              size="compact"
              items={[
                { label: "Promedio", value: days(data?.trackingAnalytics.timeToClose.avgDays ?? null) },
                { label: "Mediana", value: days(data?.trackingAnalytics.timeToClose.medianDays ?? null) },
                { label: "Clientes medidos", value: String(data?.trackingAnalytics.timeToClose.count ?? 0) },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
