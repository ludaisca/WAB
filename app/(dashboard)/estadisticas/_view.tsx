"use client";

import { useMemo } from "react";
import { BarChart3, TrendingUp, MessageCircle, Bot, Phone, DollarSign, Zap, UserCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { StatCard } from "@/app/components/ui/stat-card";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import type { Estadisticas } from "@/lib/estadisticas/get-stats";

const BOT_STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Activo", tone: "success" },
  PAUSED: { label: "Pausado", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

type BotBreakdownRow = Estadisticas["botBreakdown"][number];
type AgentPerformanceRow = Estadisticas["agentPerformance"][number];

export function EstadisticasView({ stats }: { stats: Estadisticas }) {
  const botColumns: TableColumn<BotBreakdownRow>[] = useMemo(() => [
    { key: "name", header: "Bot", render: (b) => <span className="font-medium">{b.name}</span> },
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
      render: (b) => `$${b.totalCost.toFixed(4)}`,
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

  const maxCount = Math.max(...stats.dailyMessages.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Estadísticas" description="Métricas globales de uso de la plataforma." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cuentas" value={String(stats.accounts)} icon={Phone} tone="accent" />
        <StatCard label="Chats activos" value={String(stats.chats)} icon={MessageCircle} tone="info" />
        <StatCard label="Mensajes" value={String(stats.messages)} icon={BarChart3} tone="success" />
        <StatCard label="Bots IA" value={`${stats.activeBots}/${stats.bots}`} icon={Bot} tone="warning" sublabel="activos" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
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
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <DollarSign size={18} />
                </div>
                <div>
                  <p className="text-xs text-muted-darker">Costo estimado IA</p>
                  <p className="text-xl font-bold">${stats.totalCost.toFixed(4)}</p>
                </div>
              </div>
            </CardBody>
          </Card>

          {stats.monthlyBudgetUsd != null && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-darker">Presupuesto del mes</p>
                  <p className="text-xs font-medium">
                    ${stats.monthlyCost.toFixed(2)} / ${stats.monthlyBudgetUsd.toFixed(2)}
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
            </Card>
          )}

          <Card>
            <CardBody>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info-bg text-info">
                  <Zap size={18} />
                </div>
                <div>
                  <p className="text-xs text-muted-darker">Tokens consumidos</p>
                  <p className="text-xl font-bold">{stats.totalTokens.toLocaleString()}</p>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-bg text-success">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <p className="text-xs text-muted-darker">Campañas completadas</p>
                  <p className="text-xl font-bold">{stats.campaignsCompleted}/{stats.campaigns}</p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
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
            />
          </CardBody>
        </Card>

        <Card>
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
                {stats.accountBreakdown.map((a) => {
                  const maxChats = Math.max(...stats.accountBreakdown.map((x) => x.chats), 1);
                  return (
                    <div key={a.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        {a.phoneNumber && <p className="text-xs text-muted-darker truncate">{a.phoneNumber}</p>}
                      </div>
                      <div className="w-32 shrink-0 bg-surface rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${(a.chats / maxChats) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-darker w-8 text-right shrink-0">{a.chats}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
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
          />
        </CardBody>
      </Card>
    </div>
  );
}
