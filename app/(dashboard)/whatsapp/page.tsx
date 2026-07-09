import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Phone, MessageCircle, CheckCircle2, Activity, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { StatCard } from "@/app/components/ui/stat-card";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { AddAccountButton } from "./_add-account-button";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CONNECTED:    { label: "Conectado",   tone: "success" },
  PENDING:      { label: "Pendiente",    tone: "warning" },
  ERROR:        { label: "Error",        tone: "danger" },
  DISCONNECTED: { label: "Desconectado", tone: "neutral" },
};

export default async function WhatsAppDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const sharedIds = await prisma.wAAccountShare.findMany({
    where: { userId },
    select: { waAccountId: true },
  });
  const accountsWhere = {
    OR: [
      { userId },
      ...(sharedIds.length > 0 ? [{ id: { in: sharedIds.map((s) => s.waAccountId) } }] : []),
    ],
  };

  const accountIds = await getUserAccountIds(userId);

  const [accountsCount, connectedCount, recentAccounts, chatsCount] = await Promise.all([
    prisma.wAAccount.count({ where: accountsWhere }),
    prisma.wAAccount.count({ where: { ...accountsWhere, status: "CONNECTED" } }),
    prisma.wAAccount.findMany({
      where: accountsWhere,
      select: { id: true, name: true, phoneNumber: true, phoneNumberId: true, status: true, lastActivity: true },
      take: 5,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.wAChat.count({ where: { accountId: { in: accountIds } } }),
  ]);

  const messagesCount = 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Gestión de cuentas y chats de WhatsApp Business."
        actions={<AddAccountButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuentas"
          value={String(accountsCount)}
          icon={Phone}
          tone="accent"
          sublabel={`${connectedCount} conectadas`}
        />
        <StatCard
          label="Chats activos"
          value={String(chatsCount)}
          icon={Users}
          tone="info"
        />
        <StatCard
          label="Mensajes totales"
          value={String(messagesCount)}
          icon={MessageCircle}
          tone="success"
        />
        <StatCard
          label="Última actividad"
          value={recentAccounts[0]?.lastActivity
            ? recentAccounts[0].lastActivity.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
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
            {recentAccounts.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                No hay cuentas configuradas.{" "}
                <Link href="/whatsapp/cuentas/nueva" className="text-accent hover:underline">
                  Agregar la primera
                </Link>
              </p>
            ) : (
              <div className="divide-y divide-border -mx-5">
                {recentAccounts.map((a) => {
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
