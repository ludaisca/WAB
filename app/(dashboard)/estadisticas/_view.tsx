"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  MessageCircle,
  Bot,
  Phone,
  DollarSign,
  Zap,
  UserCheck,
  Mail,
  Send,
  Megaphone,
  Target,
} from "lucide-react";
import { CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { BentoGrid, BentoTile } from "@/app/components/ui/bento-grid";
import { StatCard } from "@/app/components/ui/stat-card";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import type { Estadisticas } from "@/lib/estadisticas/get-stats";
import { LABEL_TEXT } from "@/lib/whatsapp/export-columns";

const BOT_STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Activo", tone: "success" },
  PAUSED: { label: "Pausado", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

const QUALIFIED_LABEL_BADGE: Record<string, "danger" | "success" | "info" | "neutral"> = {
  prioridad_alta: "danger",
  oportunidad: "success",
  interesado: "info",
  frio: "neutral",
  descartado: "neutral",
};

const CAMPAIGN_ORIGIN_LABEL: Record<string, string> = {
  manual: "Campaña masiva",
  automatizacion: "Automatización",
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
        const badge = BOT_STATUS_BADGE[b.status] ?? { label: b.status, tone: "neutral" as const };
        return <Badge tone={badge.tone} size="sm">{badge.label}</Badge>;
      },
    },
    {
      key: "interactions",
      header: "Interacciones",
      headerClassName: "text-right",
      cellClassName: "text-right",
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
      cellClassName: "text-right",
      render: (a) => a.resolvedCount,
    },
    {
      key: "avgFirstResponseMinutes",
      header: "1ra respuesta (prom.)",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (a) => (a.avgFirstResponseMinutes != null ? `${a.avgFirstResponseMinutes} min` : "—"),
    },
    {
      key: "avgResolutionMinutes",
      header: "Resolución (prom.)",
      headerClassName: "text-right",
      cellClassName: "text-right",
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
    { key: "sent", header: "Enviados", headerClassName: "text-right", cellClassName: "text-right", render: (r) => r.sent, hideBelow: "md" },
    { key: "delivered", header: "Entregados", headerClassName: "text-right", cellClassName: "text-right", render: (r) => r.delivered, hideBelow: "sm" },
    { key: "read", header: "Leídos", headerClassName: "text-right", cellClassName: "text-right", render: (r) => r.read },
    { key: "failed", header: "Fallidos", headerClassName: "text-right", cellClassName: "text-right", render: (r) => r.failed, hideBelow: "md" },
    {
      key: "deliveryRate",
      header: "Tasa entrega",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (r) => (r.deliveryRate != null ? `${r.deliveryRate}%` : "—"),
    },
    {
      key: "readRate",
      header: "Tasa lectura",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (r) => (r.readRate != null ? `${r.readRate}%` : "—"),
    },
  ], []);

  const maxCount = Math.max(...stats.dailyMessages.map((d) => d.count), 1);
  const maxAccountChats = Math.max(...stats.accountBreakdown.map((a) => a.chats), 1);
  const maxQualifiedByCampaign = Math.max(...stats.qualifiedChatsByCampaign.map((c) => c.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Estadísticas" description="Métricas globales de uso de la plataforma." />

      <BentoGrid>
        <StatCard label="Cuentas" value={String(stats.accounts)} icon={Phone} tone="accent" href="/whatsapp/cuentas" />
        <StatCard label="Chats activos" value={String(stats.chats)} icon={MessageCircle} tone="info" href="/whatsapp/chat" />
        <StatCard label="Mensajes" value={String(stats.messages)} icon={Mail} tone="success" href="/whatsapp/chat" />
        <StatCard label="Bots IA" value={`${stats.activeBots}/${stats.bots}`} icon={Bot} tone="success" sublabel="activos" href="/whatsapp/bots" />

        <BentoTile span={{ sm: 2, lg: 2 }} rowSpan={2}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" />
              <CardTitle>Mensajes diarios</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {stats.dailyMessages.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">Sin datos aún</p>
            ) : (
              <div className="space-y-2">
                {stats.dailyMessages.map((d) => (
                  <div key={d.date} className="flex items-center gap-3">
                    <span className="text-xs text-muted-darker w-20 shrink-0">
                      {new Date(d.date + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                    </span>
                    <div className="flex-1 bg-surface rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all flex items-center justify-end pr-2"
                        style={{ width: `${(d.count / maxCount) * 100}%`, minWidth: d.count > 0 ? "2rem" : 0 }}
                      >
                        {d.count > 0 && (
                          <span className="text-[10px] text-on-accent font-medium">{d.count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </BentoTile>

        <StatCard
          label="Costo estimado IA"
          value={formatCost(stats.totalCost)}
          icon={DollarSign}
          tone="accent"
        />

        {stats.monthlyBudgetUsd != null && (
          <BentoTile>
            <CardBody>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-darker">Presupuesto del mes</p>
                <p className="text-xs font-medium">
                  {formatCost(stats.monthlyCost)} / {formatCost(stats.monthlyBudgetUsd)}
                </p>
              </div>
              <div className="bg-surface rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    stats.monthlyCost >= stats.monthlyBudgetUsd ? "bg-danger" : "bg-accent"
                  }`}
                  style={{ width: `${Math.min(100, (stats.monthlyCost / stats.monthlyBudgetUsd) * 100)}%` }}
                />
              </div>
            </CardBody>
          </BentoTile>
        )}

        <StatCard
          label="Tokens consumidos"
          value={stats.totalTokens.toLocaleString()}
          icon={Zap}
          tone="info"
        />

        <StatCard
          label="Campañas completadas"
          value={`${stats.campaignsCompleted}/${stats.campaigns}`}
          icon={TrendingUp}
          tone="success"
          href="/whatsapp/campanas"
        />

        <BentoTile>
          <CardBody>
            <div className="flex items-center gap-1.5 mb-2">
              <Target size={14} className="text-accent" />
              <p className="text-xs text-muted-darker">Chats calificados</p>
            </div>
            <p className="text-2xl font-bold tracking-tight mb-2">{stats.qualifiedChats.total}</p>
            {stats.qualifiedChats.byLabel.length === 0 ? (
              <p className="text-xs text-muted-darker">Sin calificaciones todavía</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {stats.qualifiedChats.byLabel.map((l) => (
                  <Badge key={l.label} tone={QUALIFIED_LABEL_BADGE[l.label] ?? "neutral"} size="sm">
                    {LABEL_TEXT[l.label] ?? l.label}: {l.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 2 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Send size={16} className="text-accent" />
              <CardTitle>Entregas por origen</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {stats.campaignMessagesByOrigin.every((o) => o.total === 0) ? (
              <p className="text-sm text-muted py-4 text-center">Sin envíos todavía</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {stats.campaignMessagesByOrigin.map((o) => (
                  <div key={o.origin} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      {o.origin === "manual" ? (
                        <Megaphone size={14} className="text-accent" />
                      ) : (
                        <Zap size={14} className="text-info" />
                      )}
                      <p className="text-sm font-medium">{CAMPAIGN_ORIGIN_LABEL[o.origin]}</p>
                    </div>
                    {o.total === 0 ? (
                      <p className="text-xs text-muted-darker">Sin envíos todavía</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="neutral" size="sm">Enviados: {o.sent}</Badge>
                          <Badge tone="success" size="sm">Entregados: {o.delivered}</Badge>
                          <Badge tone="info" size="sm">Leídos: {o.read}</Badge>
                          {o.failed > 0 && <Badge tone="danger" size="sm">Fallidos: {o.failed}</Badge>}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-darker pt-1">
                          <span>Entrega: {o.deliveryRate != null ? `${o.deliveryRate}%` : "—"}</span>
                          <span>Lectura: {o.readRate != null ? `${o.readRate}%` : "—"}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 2 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target size={16} className="text-accent" />
              <CardTitle>Calificados por campaña</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {stats.qualifiedChatsByCampaign.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">Sin calificaciones todavía</p>
            ) : (
              <div className="space-y-3">
                {stats.qualifiedChatsByCampaign.map((c) => (
                  <div key={c.id ?? "__none__"} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      {c.origin && (
                        <Badge tone={CAMPAIGN_ORIGIN_BADGE[c.origin]} size="sm" className="shrink-0">
                          {CAMPAIGN_ORIGIN_LABEL[c.origin]}
                        </Badge>
                      )}
                    </div>
                    <div className="w-32 shrink-0 bg-surface rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${(c.count / maxQualifiedByCampaign) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-darker w-8 text-right shrink-0">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 4 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-accent" />
              <CardTitle>Mensajes por campaña / automatización</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <Table
              columns={campaignColumns}
              rows={stats.campaignMessageBreakdown}
              rowKey={(r) => `${r.origin}-${r.id}`}
              emptyIcon={Megaphone}
              emptyTitle="Sin envíos todavía"
              emptyDescription="Aparecerán aquí una vez que se envíe una campaña masiva o se dispare una automatización de leads."
              mobileCard={(r) => (
                <div className="space-y-1 min-w-0 w-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{r.name}</span>
                    <Badge tone={CAMPAIGN_ORIGIN_BADGE[r.origin]} size="sm">{CAMPAIGN_ORIGIN_LABEL[r.origin]}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-darker flex-wrap">
                    <span>{r.sent} enviados</span>
                    <span>{r.delivered} entregados</span>
                    <span>{r.read} leídos</span>
                    {r.failed > 0 && <span className="text-danger">{r.failed} fallidos</span>}
                  </div>
                </div>
              )}
            />
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 2 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-accent" />
              <CardTitle>Uso por bot</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
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
                  <div className="space-y-1 min-w-0 w-full">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/whatsapp/bots/${b.id}`} className="font-medium text-sm hover:text-accent transition-colors truncate">
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
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 2 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Phone size={16} className="text-accent" />
              <CardTitle>Chats por número</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {stats.accountBreakdown.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">Sin cuentas todavía</p>
            ) : (
              <div className="space-y-3">
                {stats.accountBreakdown.map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      {a.phoneNumber && <p className="text-xs text-muted-darker truncate">{a.phoneNumber}</p>}
                    </div>
                    <div className="w-32 shrink-0 bg-surface rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${(a.chats / maxAccountChats) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-darker w-8 text-right shrink-0">{a.chats}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </BentoTile>

        <BentoTile span={{ sm: 2, lg: 4 }}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserCheck size={16} className="text-accent" />
              <CardTitle>Rendimiento por agente</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
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
                  <div className="space-y-1 min-w-0 w-full">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{a.userName ?? "Sin nombre"}</span>
                      <span className="text-xs text-muted-darker shrink-0">{a.resolvedCount} resueltos</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-darker">
                      <span>1ra: {firstResponse.render(a)}</span>
                      <span>Res: {resolution.render(a)}</span>
                    </div>
                  </div>
                );
              }}
            />
          </CardBody>
        </BentoTile>
      </BentoGrid>
    </div>
  );
}
