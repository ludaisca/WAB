"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Phone, MessageCircle, CheckCircle2, Activity, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { StatCard } from "@/app/components/ui/stat-card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CONNECTED:    { label: "Conectado",   tone: "success" },
  PENDING:      { label: "Pendiente",    tone: "warning" },
  ERROR:        { label: "Error",        tone: "danger" },
  DISCONNECTED: { label: "Desconectado", tone: "neutral" },
};

interface Account {
  id: string;
  name: string;
  phoneNumber: string | null;
  phoneNumberId: string;
  status: string;
  lastActivity: string | null;
}

interface DashboardData {
  accounts: Account[];
  accountsCount: number;
  connectedCount: number;
  chatsCount: number;
  messagesCount: number;
}

export default function WhatsAppDashboardPage() {
  const { error: toastError } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, chatRes] = await Promise.all([
        fetch("/api/whatsapp/accounts"),
        fetch("/api/whatsapp/chats"),
      ]);
      const accounts = await accRes.json();
      const chats = await chatRes.json();

      const accountList = Array.isArray(accounts) ? accounts : [];
      const chatList = Array.isArray(chats) ? chats : [];

      const connected = accountList.filter(
        (a: Account) => a.status === "CONNECTED"
      ).length;

      setData({
        accounts: accountList.slice(0, 5),
        accountsCount: accountList.length,
        connectedCount: connected,
        chatsCount: chatList.length,
        messagesCount: 0,
      });
    } catch {
      toastError("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
          <p className="mt-1 text-sm text-muted">Gestión de cuentas y chats de WhatsApp Business.</p>
        </div>
        <Link href="/whatsapp/cuentas/nueva">
          <Button icon={Plus} size="sm">Agregar número</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuentas"
          value={String(data.accountsCount)}
          icon={Phone}
          tone="accent"
          sublabel={`${data.connectedCount} conectadas`}
        />
        <StatCard
          label="Chats activos"
          value={String(data.chatsCount)}
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Mensajes totales"
          value={String(data.messagesCount)}
          icon={MessageCircle}
          tone="success"
        />
        <StatCard
          label="Última actividad"
          value={data.accounts[0]?.lastActivity
            ? new Date(data.accounts[0].lastActivity).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : "—"}
          icon={Activity}
          tone="neutral"
          sublabel="Más reciente"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cuentas recientes</CardTitle>
          </CardHeader>
          <CardBody>
            {data.accounts.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                No hay cuentas configuradas.{" "}
                <Link href="/whatsapp/cuentas/nueva" className="text-accent hover:underline">
                  Agregar la primera
                </Link>
              </p>
            ) : (
              <div className="divide-y divide-border -mx-5">
                {data.accounts.map((a) => {
                  const badge = STATUS_BADGE[a.status] ?? { label: a.status, tone: "neutral" as const };
                  return (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3 hover:bg-surface-light/40 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-xs text-muted-darker truncate">{a.phoneNumber ?? a.phoneNumberId}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                        <Link
                          href={`/whatsapp/chat?accountId=${a.id}`}
                          className="text-accent hover:text-accent-hover transition-colors"
                          title="Abrir chats"
                        >
                          <MessageCircle size={16} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones rápidas</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              <Link
                href="/whatsapp/cuentas/nueva"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-light transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Plus size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium">Agregar número</p>
                  <p className="text-xs text-muted-darker">Conectar una nueva cuenta de WhatsApp Business</p>
                </div>
              </Link>
              <Link
                href="/whatsapp/chat"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-light transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-bg text-success">
                  <MessageCircle size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium">Abrir bandeja</p>
                  <p className="text-xs text-muted-darker">Ver y responder todos los chats</p>
                </div>
              </Link>
              <Link
                href="/whatsapp/cuentas"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-light transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-info-bg text-info">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium">Administrar cuentas</p>
                  <p className="text-xs text-muted-darker">Ver estado, editar o eliminar cuentas conectadas</p>
                </div>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
