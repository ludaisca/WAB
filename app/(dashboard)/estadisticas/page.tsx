"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, TrendingUp, MessageCircle, Bot, Phone, DollarSign, Zap } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { StatCard } from "@/app/components/ui/stat-card";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

const BOT_STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Activo", tone: "success" },
  PAUSED: { label: "Pausado", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
};

interface BotBreakdownRow {
  id: string;
  name: string;
  isActive: boolean;
  status: string;
  interactions: number;
  totalTokens: number;
  totalCost: number;
}

interface AccountBreakdownRow {
  id: string;
  name: string;
  phoneNumber: string | null;
  chats: number;
}

interface Stats {
  accounts: number;
  chats: number;
  messages: number;
  bots: number;
  activeBots: number;
  campaigns: number;
  campaignsCompleted: number;
  totalTokens: number;
  totalCost: number;
  dailyMessages: Array<{ date: string; count: number }>;
  botBreakdown: BotBreakdownRow[];
  accountBreakdown: AccountBreakdownRow[];
  monthlyCost: number;
  monthlyBudgetUsd: number | null;
}

export default function EstadisticasPage() {
  const { error: toastError } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/estadisticas");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchStats also used for manual refresh
  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  if (!stats) return null;

  const maxCount = Math.max(...stats.dailyMessages.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Estadísticas</h1>
        <p className="mt-1 text-sm text-muted">Métricas globales de uso de la plataforma.</p>
      </div>

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
            {stats.botBreakdown.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">Sin bots todavía</p>
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border">
                      <th className="px-5 py-2 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Bot</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Estado</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-darker uppercase tracking-wider">Interacciones</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-darker uppercase tracking-wider">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.botBreakdown.map((b) => {
                      const badge = BOT_STATUS_BADGE[b.status] ?? { label: b.status, tone: "neutral" as const };
                      return (
                        <tr key={b.id}>
                          <td className="px-5 py-2.5 font-medium">{b.name}</td>
                          <td className="px-3 py-2.5"><Badge tone={badge.tone} size="sm">{badge.label}</Badge></td>
                          <td className="px-3 py-2.5 text-right">{b.interactions}</td>
                          <td className="px-3 py-2.5 text-right">${b.totalCost.toFixed(4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
    </div>
  );
}
