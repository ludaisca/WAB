import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, Plus, Settings, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getChatVisibilityFilter } from "@/lib/whatsapp/chat-visibility";
import {
  countActiveBots,
  countBots,
  countCampaigns,
  countChats,
  countCompletedCampaigns,
  countConnectedAccounts,
} from "@/lib/estadisticas/global-counts";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { EntityAvatar } from "@/app/components/ui/avatar";
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

  // "Conversaciones recientes" muestra nombre y último mensaje, así que tiene
  // que respetar la misma visibilidad por rol que el inbox.
  const visibility = await getChatVisibilityFilter(userId, session.user.role, accountIds);
  const visibleChatsWhere = {
    accountId: { in: accountIds },
    ...(visibility ? { AND: [visibility] } : {}),
  };

  const [
    accountsTotal,
    accountsConnected,
    chatsTotal,
    unreadAgg,
    recentChats,
    botsTotal,
    botsActive,
    campaignsTotal,
    campaignsCompleted,
  ] = await Promise.all([
    Promise.resolve(accountIds.length),
    countConnectedAccounts(accountIds),
    countChats(accountIds),
    prisma.wAChat.aggregate({ where: visibleChatsWhere, _sum: { unreadCount: true } }),
    prisma.wAChat.findMany({
      where: visibleChatsWhere,
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: 8,
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
    countBots(userId),
    countActiveBots(userId),
    countCampaigns(userId),
    countCompletedCampaigns(userId),
  ]);

  const unreadCount = unreadAgg._sum.unreadCount ?? 0;

  const chats = recentChats.map((c) => ({
    id: c.id,
    accountId: c.accountId,
    name: c.name ?? c.remoteJid ?? "Desconocido",
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt,
    accountName: c.account?.name ?? "—",
  }));

  const showAccountBadge = accountsTotal > 1;

  const kpis: KpiItem[] = [
    {
      label: "Cuentas",
      value: accountsTotal === 0 ? "0" : `${accountsConnected}/${accountsTotal}`,
      hint: accountsTotal === 0 ? "Conecta tu primer número" : "conectadas",
      href: "/whatsapp/cuentas",
    },
    {
      label: "Chats activos",
      value: String(chatsTotal),
      numeric: chatsTotal,
      delta: unreadCount > 0 ? `${unreadCount} sin leer` : undefined,
      deltaTone: unreadCount > 0 ? "danger" : "neutral",
      hint: "conversaciones",
      href: "/whatsapp/chat",
    },
    {
      label: "Bots IA",
      value: botsTotal === 0 ? "0" : `${botsActive}/${botsTotal}`,
      hint: "activos",
      href: "/whatsapp/bots",
    },
    {
      label: "Campañas",
      value: campaignsTotal === 0 ? "0" : `${campaignsCompleted}/${campaignsTotal}`,
      hint: "completadas",
      href: "/whatsapp/campanas",
    },
  ];

  return (
    <div className="space-y-10">
      <div className="animate-fade-in-up">
        <PageHeader title="Panel" description="Resumen de tu actividad en WhatsApp" />
      </div>

      <div className="animate-fade-in-up animation-delay-100">
        <KpiStrip items={kpis} />
      </div>

      <Workbench>
        <WorkbenchMain>
          <section className="animate-fade-in-up animation-delay-200">
            <SectionHeader
              eyebrow="Actividad"
              title="Chats recientes"
              action={
                chatsTotal > 0 ? (
                  <Link
                    href="/whatsapp/chat"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline underline-offset-2"
                  >
                    Ver bandeja <ArrowRight size={12} />
                  </Link>
                ) : undefined
              }
            />

            {chats.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-darker">No hay conversaciones aún.</p>
                <p className="text-xs text-muted mt-1">
                  Conecta un número de WhatsApp para empezar a recibir mensajes.
                </p>
              </div>
            ) : (
              <div className="mt-3 divide-y divide-border">
                {chats.map((chat) => (
                  <Link
                    key={chat.id}
                    href={`/whatsapp/chat/${chat.accountId}/${chat.id}`}
                    className="flex items-center gap-3 py-3 transition-colors hover:bg-surface/60"
                  >
                    <EntityAvatar id={chat.accountId} name={chat.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{chat.name}</p>
                      <p className="truncate text-xs text-muted-darker">{chat.lastMessage ?? "—"}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-mono text-[11px] text-muted-darker">
                        {formatTime(chat.lastMessageAt)}
                      </span>
                      {showAccountBadge && (
                        <Badge tone="neutral" size="sm">{chat.accountName}</Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </WorkbenchMain>

        <WorkbenchAside>
          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Atajos" title="Acceso rápido" />

            <div className="mt-3 divide-y divide-border">
              <Link
                href="/whatsapp/cuentas?nueva=1"
                className="flex items-center gap-3 py-3.5 transition-colors hover:bg-surface/60"
              >
                <IconBox icon={Plus} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Agregar número</p>
                  <p className="truncate text-xs text-muted-darker">Conectar cuenta WhatsApp Business</p>
                </div>
              </Link>

              <Link
                href="/whatsapp/chat"
                className="flex items-center gap-3 py-3.5 transition-colors hover:bg-surface/60"
              >
                <IconBox icon={MessageCircle} size="sm" tone="info" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Bandeja de chats</p>
                  <p className="truncate text-xs text-muted-darker">Ver y responder conversaciones</p>
                </div>
              </Link>

              <Link
                href="/configuracion"
                className="flex items-center gap-3 py-3.5 transition-colors hover:bg-surface/60"
              >
                <IconBox icon={Settings} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Configuración</p>
                  <p className="truncate text-xs text-muted-darker">Administrar perfil y ajustes IA</p>
                </div>
              </Link>
            </div>
          </section>
        </WorkbenchAside>
      </Workbench>
    </div>
  );
}
