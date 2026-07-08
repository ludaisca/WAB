"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, TrendingUp, MessageCircle, Bot, Phone, DollarSign, Zap } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { StatCard } from "@/app/components/ui/stat-card";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

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
    </div>
  );
}
