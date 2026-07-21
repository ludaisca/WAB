"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bot, Megaphone, UserCheck, Zap } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { TrendChart, DonutChart, FunnelBars } from "@/app/components/ui/chart";
import { AnimatedNumber } from "@/app/components/ui/animated-number";
import type { Estadisticas } from "@/lib/estadisticas/get-stats";
import { CAMPAIGN_ORIGIN_LABEL, LABEL_TEXT } from "@/lib/whatsapp/export-columns";

function botStatusBadge(b: { status: string; isActive: boolean }): { label: string; tone: "success" | "danger" | "neutral" } {
  if (b.status === "ERROR") return { label: "Error", tone: "danger" };
  if (!b.isActive) return { label: "Inactivo", tone: "neutral" };
  return { label: "Activo", tone: "success" };
}

// Colores de la dona de calificaciones. Son tokens de ESTADO (no la paleta
// categórica): cada etiqueta tiene un significado fijo, así que el color lo
// refuerza en vez de solo distinguir. La dona lleva etiquetas directas
// (nombre + valor + %), de modo que la identidad nunca depende solo del color.
const QUALIFIED_LABEL_COLOR: Record<string, string> = {
  prioridad_alta: "var(--danger)",
  oportunidad: "var(--success)",
  interesado: "var(--info)",
  frio: "var(--muted)",
  descartado: "var(--muted-darker)",
};

const CAMPAIGN_ORIGIN_BADGE: Record<string, "accent" | "info"> = {
  manual: "accent",
  automatizacion: "info",
};

type BotBreakdownRow = Estadisticas["botBreakdown"][number];
type AgentPerformanceRow = Estadisticas["agentPerformance"][number];
type CampaignBreakdownRow = Estadisticas["campaignMessageBreakdown"][number];

function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

export function EstadisticasView({ stats }: { stats: Estadisticas }) {
  const botColumns: TableColumn<BotBreakdownRow>[] = useMemo(() => [
    {
      key: "name",
      header: "Bot",
      render: (b) => (
        <Link href={`/whatsapp/bots/${b.id}`} className="font-medium hover:text-accent transition-colors">
          {b.name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (b) => {
        const badge = botStatusBadge(b);
        return <Badge tone={badge.tone} size="sm">{badge.label}</Badge>;
      },
    },
    {
      key: "interactions",
      header: "Interacciones",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (b) => b.interactions,
    },
    {
      key: "totalCost",
      header: "Costo",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (b) => <span className="font-mono text-xs">{formatCost(b.totalCost)}</span>,
    },
  ], []);

  const agentColumns: TableColumn<AgentPerformanceRow>[] = useMemo(() => [
    { key: "userName", header: "Agente", render: (a) => <span className="font-medium">{a.userName ?? "Sin nombre"}</span> },
    {
      key: "resolvedCount",
      header: "Resueltos",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (a) => a.resolvedCount,
    },
    {
      key: "avgFirstResponseMinutes",
      header: "1ra respuesta (prom.)",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (a) => (a.avgFirstResponseMinutes != null ? `${a.avgFirstResponseMinutes} min` : "—"),
    },
    {
      key: "avgResolutionMinutes",
      header: "Resolución (prom.)",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (a) => (a.avgResolutionMinutes != null ? `${a.avgResolutionMinutes} min` : "—"),
    },
  ], []);

  const campaignColumns: TableColumn<CampaignBreakdownRow>[] = useMemo(() => [
    {
      key: "name",
      header: "Campaña / fuente",
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "origin",
      header: "Origen",
      render: (r) => <Badge tone={CAMPAIGN_ORIGIN_BADGE[r.origin]} size="sm">{CAMPAIGN_ORIGIN_LABEL[r.origin]}</Badge>,
    },
    { key: "sent", header: "Enviados", headerClassName: "text-right", cellClassName: "text-right font-mono text-xs", render: (r) => r.sent, hideBelow: "md" },
    { key: "delivered", header: "Entregados", headerClassName: "text-right", cellClassName: "text-right font-mono text-xs", render: (r) => r.delivered, hideBelow: "sm" },
    { key: "read", header: "Leídos", headerClassName: "text-right", cellClassName: "text-right font-mono text-xs", render: (r) => r.read },
    { key: "failed", header: "Fallidos", headerClassName: "text-right", cellClassName: "text-right font-mono text-xs", render: (r) => r.failed, hideBelow: "md" },
    {
      key: "deliveryRate",
      header: "Tasa entrega",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (r) => (r.deliveryRate != null ? `${r.deliveryRate}%` : "—"),
    },
    {
      key: "readRate",
      header: "Tasa lectura",
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-xs",
      render: (r) => (r.readRate != null ? `${r.readRate}%` : "—"),
    },
  ], []);

  const maxAccountChats = Math.max(...stats.accountBreakdown.map((a) => a.chats), 1);
  const maxQualifiedByCampaign = Math.max(...stats.qualifiedChatsByCampaign.map((c) => c.count), 1);

  // El chart recibe la fecha ya formateada como etiqueta del eje X.
  const dailySeries = useMemo(
    () =>
      stats.dailyMessages.map((d) => ({
        label: new Date(d.date + "T00:00:00").toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        }),
        count: d.count,
      })),
    [stats.dailyMessages]
  );

  const qualifiedSlices = useMemo(
    () =>
      stats.qualifiedChats.byLabel.map((l) => ({
        name: LABEL_TEXT[l.label] ?? l.label,
        value: l.count,
        color: QUALIFIED_LABEL_COLOR[l.label] ?? "var(--muted-darker)",
      })),
    [stats.qualifiedChats.byLabel]
  );

  const kpis: KpiItem[] = [
    { label: "Cuentas", value: String(stats.accounts), numeric: stats.accounts, href: "/whatsapp/cuentas" },
    { label: "Chats activos", value: String(stats.chats), numeric: stats.chats, href: "/whatsapp/chat" },
    { label: "Mensajes", value: stats.messages.toLocaleString("es-MX"), numeric: stats.messages, href: "/whatsapp/chat" },
    { label: "Bots IA", value: `${stats.activeBots}/${stats.bots}`, hint: "activos", href: "/whatsapp/bots" },
    {
      label: "Campañas",
      value: `${stats.campaignsCompleted}/${stats.campaigns}`,
      hint: "completadas",
      href: "/whatsapp/campanas",
    },
  ];

  const budgetPct =
    stats.monthlyBudgetUsd != null && stats.monthlyBudgetUsd > 0
      ? Math.min(100, (stats.monthlyCost / stats.monthlyBudgetUsd) * 100)
      : null;

  return (
    <div className="space-y-10">
      <div className="animate-fade-in-up">
        <PageHeader title="Estadísticas" description="Métricas globales de uso de la plataforma." />
      </div>

      <div className="animate-fade-in-up animation-delay-100">
        <KpiStrip items={kpis} />
      </div>

      <Workbench>
        <WorkbenchMain>
          <section className="animate-fade-in-up animation-delay-200">
            <SectionHeader eyebrow="Actividad" title="Mensajes diarios" />
            {/* Serie temporal → área con línea, no barras horizontales: el eje X
                ordenado por fecha hace legible la tendencia, que era lo que la
                lista de barras escondía. */}
            <div className="mt-4">
              <TrendChart
                data={dailySeries}
                series={[{ key: "count", name: "Mensajes" }]}
                height={260}
              />
            </div>
          </section>

          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Difusión" title="Mensajes por campaña / automatización" />
            <div className="mt-4">
              <Table
                columns={campaignColumns}
                rows={stats.campaignMessageBreakdown}
                rowKey={(r) => `${r.origin}-${r.id}`}
                emptyIcon={Megaphone}
                emptyTitle="Sin envíos todavía"
                emptyDescription="Aparecerán aquí una vez que se envíe una campaña masiva o se dispare una automatización de leads."
                mobileCard={(r) => (
                  <div className="w-full min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <Badge tone={CAMPAIGN_ORIGIN_BADGE[r.origin]} size="sm">{CAMPAIGN_ORIGIN_LABEL[r.origin]}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-darker">
                      <span>{r.sent} enviados</span>
                      <span>{r.delivered} entregados</span>
                      <span>{r.read} leídos</span>
                      {r.failed > 0 && <span className="text-danger">{r.failed} fallidos</span>}
                    </div>
                  </div>
                )}
              />
            </div>
          </section>

          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Automatización" title="Uso por bot" />
            <div className="mt-4">
              <Table
                columns={botColumns}
                rows={stats.botBreakdown}
                rowKey={(b) => b.id}
                emptyIcon={Bot}
                emptyTitle="Sin bots todavía"
                mobileCard={(b) => {
                  const status = botColumns.find((c) => c.key === "status")!;
                  const cost = botColumns.find((c) => c.key === "totalCost")!;
                  return (
                    <div className="w-full min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/whatsapp/bots/${b.id}`} className="truncate text-sm font-medium hover:text-accent transition-colors">
                          {b.name}
                        </Link>
                        {status.render(b)}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-darker">
                        <span>{b.interactions} interacciones</span>
                        {cost.render(b)}
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </section>

          <section className="animate-fade-in-up animation-delay-400">
            <SectionHeader eyebrow="Equipo" title="Rendimiento por agente" />
            <div className="mt-4">
              <Table
                columns={agentColumns}
                rows={stats.agentPerformance}
                rowKey={(a) => a.userId}
                emptyIcon={UserCheck}
                emptyTitle="Sin datos todavía"
                emptyDescription="Aparecerán agentes aquí una vez que se asignen y respondan chats."
                mobileCard={(a) => {
                  const firstResponse = agentColumns.find((c) => c.key === "avgFirstResponseMinutes")!;
                  const resolution = agentColumns.find((c) => c.key === "avgResolutionMinutes")!;
                  return (
                    <div className="w-full min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{a.userName ?? "Sin nombre"}</span>
                        <span className="shrink-0 text-xs text-muted-darker">{a.resolvedCount} resueltos</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-darker">
                        <span>1ra: {firstResponse.render(a)}</span>
                        <span>Res: {resolution.render(a)}</span>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </section>
        </WorkbenchMain>

        <WorkbenchAside>
          <section className="animate-fade-in-up animation-delay-200">
            <SectionHeader eyebrow="Inteligencia artificial" title="Inversión en IA" />
            <div className="mt-3 space-y-4">
              <div>
                <p className="font-mono text-hero font-semibold tracking-tight">{formatCost(stats.totalCost)}</p>
                <p className="text-xs text-muted">costo estimado histórico</p>
              </div>
              <div className="flex items-baseline gap-2">
                <Zap size={13} className="text-info shrink-0 self-center" />
                <span className="font-mono text-sm font-medium">
                  <AnimatedNumber value={stats.totalTokens} />
                </span>
                <span className="text-xs text-muted">tokens consumidos</span>
              </div>

              {stats.monthlyBudgetUsd != null && budgetPct != null && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-muted-darker">Presupuesto del mes</p>
                    <p className="font-mono text-xs font-medium">
                      {formatCost(stats.monthlyCost)} / {formatCost(stats.monthlyBudgetUsd)}
                    </p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div
                      className={`h-full rounded-full transition-all ${
                        stats.monthlyCost >= stats.monthlyBudgetUsd ? "bg-danger" : "bg-accent"
                      }`}
                      style={{ width: `${budgetPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Leads" title="Chats calificados" />
            <div className="mt-3 space-y-3">
              <div>
                <p className="font-mono text-hero font-semibold tracking-tight">
                  <AnimatedNumber value={stats.qualifiedChats.total} />
                </p>
                {/* Deduplicado por chat (mejor score) — por eso puede no coincidir
                    con la pestaña "Leads calificados", que lista cada evaluación. */}
                <p className="text-xs text-muted" title="Chats únicos con al menos una calificación — no evaluaciones individuales">
                  chats únicos, no evaluaciones
                </p>
              </div>
              {qualifiedSlices.length === 0 ? (
                <p className="text-xs text-muted-darker">Sin calificaciones todavía</p>
              ) : (
                // fold={false}: cada etiqueta es un estado con significado propio;
                // plegar la más pequeña en "Otros" borraría una categoría real.
                <DonutChart data={qualifiedSlices} height={168} fold={false} totalLabel="calificados" />
              )}

              {stats.qualifiedChatsByCampaign.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <p className="text-eyebrow font-medium uppercase tracking-wider text-muted-darker">Por campaña</p>
                  {stats.qualifiedChatsByCampaign.map((c) => (
                    <div key={c.id ?? "__none__"} className="flex items-center gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <p className="truncate text-sm">{c.name}</p>
                        {c.origin && (
                          <Badge tone={CAMPAIGN_ORIGIN_BADGE[c.origin]} size="sm" className="shrink-0">
                            {CAMPAIGN_ORIGIN_LABEL[c.origin]}
                          </Badge>
                        )}
                      </div>
                      <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${(c.count / maxQualifiedByCampaign) * 100}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-darker">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Difusión" title="Entregas por origen" />
            {stats.campaignMessagesByOrigin.every((o) => o.total === 0) ? (
              <p className="py-4 text-center text-sm text-muted">Sin envíos todavía</p>
            ) : (
              <div className="mt-3 divide-y divide-border">
                {stats.campaignMessagesByOrigin.map((o) => (
                  <div key={o.origin} className="space-y-2 py-3 first:pt-0">
                    <p className="text-sm font-medium">{CAMPAIGN_ORIGIN_LABEL[o.origin]}</p>
                    {o.total === 0 ? (
                      <p className="text-xs text-muted-darker">Sin envíos todavía</p>
                    ) : (
                      <>
                        {/* Embudo: enviados → entregados → leídos ya expresa las
                            tasas de forma visual, así que las líneas de % sueltas
                            sobraban. Los fallidos no son un paso del embudo. */}
                        <FunnelBars
                          steps={[
                            { name: "Enviados", value: o.sent },
                            { name: "Entregados", value: o.delivered },
                            { name: "Leídos", value: o.read },
                          ]}
                        />
                        {o.failed > 0 && (
                          <Badge tone="danger" size="sm">Fallidos: {o.failed}</Badge>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="animate-fade-in-up animation-delay-400">
            <SectionHeader eyebrow="Canales" title="Chats por número" />
            {stats.accountBreakdown.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">Sin cuentas todavía</p>
            ) : (
              <div className="mt-3 space-y-3">
                {stats.accountBreakdown.map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      {a.phoneNumber && <p className="truncate font-mono text-xs text-muted-darker">{a.phoneNumber}</p>}
                    </div>
                    <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${(a.chats / maxAccountChats) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-darker">{a.chats}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </WorkbenchAside>
      </Workbench>
    </div>
  );
}
