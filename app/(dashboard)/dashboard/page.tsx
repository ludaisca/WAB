import Link from "next/link";
import { redirect } from "next/navigation";
import { Phone, MessageCircle, Bot, Megaphone, Plus, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { StatCard } from "@/app/components/ui/stat-card";
import { Card, CardTitle } from "@/app/components/ui/card";
import { IconBox } from "@/app/components/ui/icon-box";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";

function formatTime(ts: Date | null): string {
  if (!ts) return "—";
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  return ts.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const accountIds = await getUserAccountIds(userId);

  const [
    accountsTotal,
    accountsConnected,
    chatsTotal,
    recentChats,
    botsTotal,
    botsActive,
    campaignsTotal,
    campaignsCompleted,
  ] = await Promise.all([
    Promise.resolve(accountIds.length),
    prisma.wAAccount.count({ where: { id: { in: accountIds }, status: "CONNECTED" } }),
    prisma.wAChat.count({ where: { accountId: { in: accountIds } } }),
    prisma.wAChat.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: 5,
      select: {
        id: true,
        accountId: true,
        name: true,
        remoteJid: true,
        lastMessage: true,
        lastMessageAt: true,
        account: { select: { name: true } },
      },
    }),
    prisma.wABot.count({ where: { userId } }),
    prisma.wABot.count({ where: { userId, isActive: true } }),
    prisma.wACampaign.count({ where: { userId } }),
    prisma.wACampaign.count({ where: { userId, status: "COMPLETED" } }),
  ]);

  const chats = {
    total: chatsTotal,
    recent: recentChats.map((c) => ({
      id: c.id,
      accountId: c.accountId,
      name: c.name ?? c.remoteJid ?? "Desconocido",
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt,
      accountName: c.account?.name ?? "—",
    })),
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Panel" description="Resumen de tu actividad en WhatsApp" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cuentas"
          value={`${accountsConnected}/${accountsTotal}`}
          icon={Phone}
          tone="accent"
          sublabel="conectadas"
        />
        <StatCard
          label="Chats activos"
          value={String(chats.total)}
          icon={MessageCircle}
          tone="info"
          sublabel="conversaciones"
        />
        <StatCard
          label="Bots IA"
          value={`${botsActive}/${botsTotal}`}
          icon={Bot}
          tone="success"
          sublabel="activos"
        />
        <StatCard
          label="Campañas"
          value={`${campaignsCompleted}/${campaignsTotal}`}
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
              {chats.total > 0 && (
                <Link
                  href="/whatsapp/chat"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline underline-offset-2"
                >
                  Ver bandeja <ArrowRight size={12} />
                </Link>
              )}
            </div>

            {chats.recent.length === 0 ? (
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
                    {chats.recent.map((chat) => (
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

            {chats.recent.length > 0 && (
              <div className="sm:hidden divide-y divide-border">
                {chats.recent.map((chat) => (
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
            href="/whatsapp/bots"
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
