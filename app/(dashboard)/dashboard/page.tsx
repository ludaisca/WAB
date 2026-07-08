"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Phone, MessageCircle, Bot, Megaphone, Plus, ArrowRight } from "lucide-react";
import { StatCard } from "@/app/components/ui/stat-card";
import { Card, CardTitle } from "@/app/components/ui/card";
import { IconBox } from "@/app/components/ui/icon-box";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface DashboardData {
  accounts: { total: number; connected: number };
  chats: { total: number; recent: Array<{ id: string; accountId: string; name: string; lastMessage: string | null; lastMessageAt: string | null; accountName: string }> };
  bots: { total: number; active: number };
  campaigns: { total: number; completed: number };
}

export default function DashboardPage() {
  const { error: toastError } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, chatsRes, botsRes, campsRes] = await Promise.all([
        fetch("/api/whatsapp/accounts"),
        fetch("/api/whatsapp/chats"),
        fetch("/api/whatsapp/bots"),
        fetch("/api/whatsapp/campaigns"),
      ]);

      const accounts = await accRes.json();
      const chats = await chatsRes.json();
      const bots = await botsRes.json();
      const campaigns = await campsRes.json();

      const accountList = Array.isArray(accounts) ? accounts : [];
      const chatList = Array.isArray(chats) ? chats : [];
      const botList = Array.isArray(bots) ? bots : [];
      const campaignList = Array.isArray(campaigns) ? campaigns : [];

      setData({
        accounts: {
          total: accountList.length,
          connected: accountList.filter((a: { status: string }) => a.status === "CONNECTED").length,
        },
        chats: {
          total: chatList.length,
          recent: chatList.slice(0, 5).map((c: {
            id: string;
            accountId: string;
            name: string | null;
            remoteJid: string;
            lastMessage: string | null;
            lastMessageAt: string | null;
            account: { name: string };
          }) => ({
            id: c.id,
            accountId: c.accountId,
            name: c.name ?? c.remoteJid ?? "Desconocido",
            lastMessage: c.lastMessage,
            lastMessageAt: c.lastMessageAt,
            accountName: c.account?.name ?? "—",
          })),
        },
        bots: {
          total: botList.length,
          active: botList.filter((b: { isActive: boolean }) => b.isActive).length,
        },
        campaigns: {
          total: campaignList.length,
          completed: campaignList.filter((c: { status: string }) => c.status === "COMPLETED").length,
        },
      });
    } catch {
      toastError("Error al cargar el panel");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Panel</h1>
          <p className="mt-1 text-sm text-muted">Error al cargar los datos.</p>
        </div>
      </div>
    );
  }

  function formatTime(ts: string | null): string {
    if (!ts) return "—";
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "Ahora";
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH}h`;
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Panel</h1>
        <p className="mt-1 text-sm text-muted">Resumen de tu actividad en WhatsApp</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuentas"
          value={`${data.accounts.connected}/${data.accounts.total}`}
          icon={Phone}
          tone="accent"
          sublabel="conectadas"
        />
        <StatCard
          label="Chats activos"
          value={String(data.chats.total)}
          icon={MessageCircle}
          tone="info"
          sublabel="conversaciones"
        />
        <StatCard
          label="Bots IA"
          value={`${data.bots.active}/${data.bots.total}`}
          icon={Bot}
          tone="success"
          sublabel="activos"
        />
        <StatCard
          label="Campañas"
          value={`${data.campaigns.completed}/${data.campaigns.total}`}
          icon={Megaphone}
          tone="warning"
          sublabel="completadas"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card padding="none">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} className="text-accent" />
                <CardTitle>Chats recientes</CardTitle>
              </div>
              {data.chats.total > 0 && (
                <Link
                  href="/whatsapp/chat"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline underline-offset-2"
                >
                  Ver bandeja <ArrowRight size={12} />
                </Link>
              )}
            </div>

            {data.chats.recent.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-muted-darker">No hay conversaciones aún.</p>
                <p className="text-xs text-muted mt-1">
                  Conecta un número de WhatsApp para empezar a recibir mensajes.
                </p>
              </div>
            ) : (
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Contacto</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Último mensaje</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Cuenta</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase tracking-wider">Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.chats.recent.map((chat) => (
                      <tr key={chat.id} className="hover:bg-surface-light/40 transition-colors">
                        <td className="px-5 py-3">
                          <Link
                            href={`/whatsapp/chat/${chat.accountId}/${chat.id}`}
                            className="font-medium text-sm hover:text-accent transition-colors"
                          >
                            {chat.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-darker max-w-[200px] truncate">
                          {chat.lastMessage ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone="neutral" size="sm">{chat.accountName}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-darker text-right">
                          {formatTime(chat.lastMessageAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.chats.recent.length > 0 && (
              <div className="sm:hidden divide-y divide-border">
                {data.chats.recent.map((chat) => (
                  <Link
                    key={chat.id}
                    href={`/whatsapp/chat/${chat.accountId}/${chat.id}`}
                    className="block px-5 py-4 hover:bg-surface-light/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{chat.name}</p>
                        <p className="text-xs text-muted-darker truncate mt-0.5">
                          {chat.lastMessage ?? "—"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-muted-darker">
                          {formatTime(chat.lastMessageAt)}
                        </span>
                        <Badge tone="neutral" size="sm">{chat.accountName}</Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <CardTitle className="mb-1">Acceso rápido</CardTitle>

          <Link
            href="/whatsapp/cuentas/nueva"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-light p-3.5 transition-all hover:border-accent/30 hover:shadow-sm"
          >
            <IconBox icon={Plus} size="sm" tone="accent" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Agregar número</p>
              <p className="text-xs text-muted-darker truncate">Conectar cuenta WhatsApp Business</p>
            </div>
          </Link>

          <Link
            href="/whatsapp/chat"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-light p-3.5 transition-all hover:border-accent/30 hover:shadow-sm"
          >
            <IconBox icon={MessageCircle} size="sm" tone="info" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Bandeja de chats</p>
              <p className="text-xs text-muted-darker truncate">Ver y responder conversaciones</p>
            </div>
          </Link>

          <Link
            href="/whatsapp/bots/nueva"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-light p-3.5 transition-all hover:border-accent/30 hover:shadow-sm"
          >
            <IconBox icon={Bot} size="sm" tone="success" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Crear bot IA</p>
              <p className="text-xs text-muted-darker truncate">Automatizar respuestas con IA</p>
            </div>
          </Link>

          <Link
            href="/whatsapp/campanas/nueva"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-light p-3.5 transition-all hover:border-accent/30 hover:shadow-sm"
          >
            <IconBox icon={Megaphone} size="sm" tone="warning" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Nueva campaña</p>
              <p className="text-xs text-muted-darker truncate">Enviar mensajes masivos</p>
            </div>
          </Link>

          <Link
            href="/configuracion"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-light p-3.5 transition-all hover:border-accent/30 hover:shadow-sm"
          >
            <IconBox icon={Plus} size="sm" tone="accent" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Configuración</p>
              <p className="text-xs text-muted-darker truncate">Administrar perfil y ajustes IA</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
