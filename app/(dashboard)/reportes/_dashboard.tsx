"use client";

import { useEffect, useState } from "react";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { TrendChart, DonutChart, FunnelBars } from "@/app/components/ui/chart";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { SkeletonKpi, Skeleton } from "@/app/components/ui/skeleton";
import { labelText } from "@/lib/whatsapp/export-columns";
import { formatDate, zonedDateTimeToUtc } from "@/lib/timezone";
import type { ReportDashboardData } from "./_types";

// Duplicado a propósito (6 líneas) en vez de importar de
// estadisticas/_view.tsx — evita acoplar dos rutas por un helper privado de
// otra pantalla, mismo criterio que el resto de este archivo.
function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

// Mismos colores por label que estadisticas/_view.tsx:QUALIFIED_LABEL_COLOR —
// duplicado por el mismo motivo que formatCost arriba.
const QUALIFIED_LABEL_COLOR: Record<string, string> = {
  prioridad_alta: "var(--danger)",
  oportunidad: "var(--success)",
  interesado: "var(--info)",
  frio: "var(--muted)",
  descartado: "var(--muted-darker)",
};

// Duplicado a propósito de estadisticas/_view.tsx:FindingsList — mismo
// motivo que formatCost/QUALIFIED_LABEL_COLOR arriba, no acoplar dos rutas
// por un componente privado de la otra.
function FindingsList({ title, tone, items }: { title: string; tone: string; items: Array<{ value: string; count: number }> }) {
  return (
    <div>
      <p className="mb-1 text-xs" style={{ color: tone }}>{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-darker">Sin datos en este rango</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
          {items.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{item.value}</span>
              <span className="shrink-0 font-mono text-xs text-muted-darker">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReportesDashboard({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [data, setData] = useState<ReportDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch al cambiar el rango; el loading debe reflejarse antes de que la respuesta llegue
    setLoading(true);
    fetch(`/api/reportes/dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al cargar el dashboard");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  if (loading && !data) {
    return (
      <div className="space-y-8">
        <SkeletonKpi count={5} />
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="space-y-10 lg:col-span-2">
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <div className="space-y-10">
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <Banner tone="danger" title="No se pudo cargar el dashboard">{error}</Banner>;
  }

  if (!data) return null;

  const { kpis, dailyMessages, leadsByLabel, campaignFunnel, botCostRows, diagnostics } = data;

  const kpiItems: KpiItem[] = [
    { label: "Mensajes", value: kpis.messagesTotal.toLocaleString("es-MX"), numeric: kpis.messagesTotal },
    { label: "Chats activos", value: kpis.chatsActive.toLocaleString("es-MX"), numeric: kpis.chatsActive },
    { label: "Contactos nuevos", value: kpis.contactsNew.toLocaleString("es-MX"), numeric: kpis.contactsNew },
    { label: "Costo IA", value: formatCost(kpis.aiCost) },
    { label: "Leads calificados", value: kpis.leadsQualified.toLocaleString("es-MX"), numeric: kpis.leadsQualified },
  ];

  const dailySeries = dailyMessages.map((d) => ({
    label: formatDate(zonedDateTimeToUtc(d.date, "00:00"), { day: "2-digit", month: "short" }),
    inbound: d.inbound,
    outbound: d.outbound,
  }));

  const qualifiedSlices = leadsByLabel.map((l) => ({
    name: labelText(l.label),
    value: l.count,
    color: QUALIFIED_LABEL_COLOR[l.label] ?? "var(--muted-darker)",
  }));

  // Mismo criterio que dailySeries: el chart recibe la fecha ya formateada
  // como etiqueta del eje X. Series fijas en el mismo orden que
  // qualificationTrend (lib/reports/queries/dashboard.ts) — 4 exacto, el
  // tope de la paleta categórica (chart.tsx:MAX_SERIES).
  const qualificationTrendSeries = data.qualificationTrend.map((d) => ({
    label: formatDate(zonedDateTimeToUtc(d.date, "00:00"), { day: "2-digit", month: "short" }),
    frio: d.frio,
    interesado: d.interesado,
    oportunidad: d.oportunidad,
    prioridad_alta: d.prioridad_alta,
  }));

  const funnelSteps = [
    { name: "Enviados", value: campaignFunnel.sent },
    { name: "Entregados", value: campaignFunnel.delivered },
    { name: "Leídos", value: campaignFunnel.read },
  ];

  const isEmpty =
    kpis.messagesTotal === 0 && kpis.chatsActive === 0 && kpis.contactsNew === 0 && kpis.leadsQualified === 0;

  return (
    <div className="space-y-8">
      <KpiStrip items={kpiItems} />

      {diagnostics.issuesFound > 0 && (
        <Banner tone="warning" title="Hallazgos de diagnóstico en este rango">
          {diagnostics.high} de alta severidad, {diagnostics.medium} de media — mismo barrido que la hoja
          &quot;Diagnóstico&quot; del reporte .xlsx.
        </Banner>
      )}

      {isEmpty ? (
        <p className="py-10 text-center text-sm text-muted">Sin actividad en este rango.</p>
      ) : (
        <Workbench>
          <WorkbenchMain>
            <section>
              <SectionHeader eyebrow="Actividad" title="Mensajes diarios" />
              <div className="mt-4">
                <TrendChart
                  data={dailySeries}
                  series={[
                    { key: "inbound", name: "Entrantes" },
                    { key: "outbound", name: "Salientes" },
                  ]}
                  height={260}
                />
              </div>
            </section>

            <section>
              <SectionHeader eyebrow="Difusión" title="Embudo de campañas" />
              <div className="mt-4 space-y-2">
                <FunnelBars steps={funnelSteps} />
                {campaignFunnel.failed > 0 && (
                  <p className="text-xs text-danger">Fallidos: {campaignFunnel.failed.toLocaleString("es-MX")}</p>
                )}
              </div>
            </section>

            <section>
              <SectionHeader eyebrow="Leads" title="Tendencia de calificación" />
              {qualificationTrendSeries.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Sin calificaciones en este rango</p>
              ) : (
                <div className="mt-4">
                  <TrendChart
                    data={qualificationTrendSeries}
                    series={[
                      { key: "frio", name: "Frío" },
                      { key: "interesado", name: "Interesado" },
                      { key: "oportunidad", name: "Oportunidad" },
                      { key: "prioridad_alta", name: "Prioridad alta" },
                    ]}
                    height={240}
                  />
                </div>
              )}
            </section>

            <section>
              <SectionHeader eyebrow="Leads" title="Hallazgos más frecuentes" />
              {/* Top-5 por campo cualitativo de WALeadScore.details en el rango —
                  antes solo se veían evaluación por evaluación en la hoja
                  "Leads calificados" del .xlsx. */}
              <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                <FindingsList title="Producto de interés" tone="var(--accent)" items={data.leadFindings.topProductos} />
                <FindingsList title="Objeciones / dudas" tone="var(--danger)" items={data.leadFindings.topObjeciones} />
                <FindingsList title="Señales de compra" tone="var(--success)" items={data.leadFindings.topSenales} />
                <FindingsList title="Urgencia" tone="var(--info)" items={data.leadFindings.topUrgencia} />
              </div>
            </section>
          </WorkbenchMain>

          <WorkbenchAside>
            <section>
              <SectionHeader eyebrow="Leads" title="Calificados por etiqueta" />
              <div className="mt-4 space-y-3">
                {(data.qualifiedAvgScore != null || data.qualifiedConversionRate != null) && (
                  <div className="flex flex-wrap gap-2">
                    {data.qualifiedAvgScore != null && (
                      <Badge tone="neutral" size="sm">Score promedio: {data.qualifiedAvgScore}</Badge>
                    )}
                    {data.qualifiedConversionRate != null && (
                      <span title="% de leads reales (sin descartados) que llegan a oportunidad o más">
                        <Badge tone="accent" size="sm">{data.qualifiedConversionRate}% llegan a oportunidad+</Badge>
                      </span>
                    )}
                  </div>
                )}
                {qualifiedSlices.length === 0 ? (
                  <p className="text-sm text-muted-darker">Sin calificaciones en este rango</p>
                ) : (
                  <DonutChart data={qualifiedSlices} height={168} fold={false} totalLabel="calificados" />
                )}
              </div>
            </section>

            <section>
              <SectionHeader eyebrow="Leads" title="Embudo de calificación" />
              <div className="mt-4">
                <FunnelBars steps={data.qualificationFunnel} />
              </div>
            </section>

            <section>
              <SectionHeader eyebrow="Automatización" title="Costo por bot" />
              <div className="mt-4">
                {botCostRows.length === 0 ? (
                  <p className="text-sm text-muted-darker">Sin uso de bots en este rango</p>
                ) : (
                  <ul className="space-y-2.5">
                    {botCostRows.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{b.name}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-darker">{formatCost(b.totalCost)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </WorkbenchAside>
        </Workbench>
      )}
    </div>
  );
}
