import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, Plus, Settings, ArrowRight, Inbox, Clock, Bot, AlertTriangle, Activity, DatabaseBackup } from "lucide-react";
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
import { getSentMessagesStats } from "@/lib/estadisticas/sent-messages";
import { getAttentionSummary } from "@/lib/estadisticas/attention";
import { Banner } from "@/app/components/ui/banner";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { MessagesSentCard } from "./_messages-sent-card";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { IconBox } from "@/app/components/ui/icon-box";
import { Badge } from "@/app/components/ui/badge";
import { PageHeader } from "@/app/components/ui/page-header";
import { formatDate } from "@/lib/timezone";

// Server Component — este render corre una sola vez en el servidor (sin
// hidratación/corrección del lado del cliente), así que el fallback de fecha
// debe llevar timeZone explícito o cada visitante vería la hora del servidor
// (UTC) en vez de CDMX. El "hace X min/h" es agnóstico de zona (solo resta
// epochs), no necesita el fix.
function formatTime(ts: Date | null): string {
  if (!ts) return "—";
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  return formatDate(ts, { day: "2-digit", month: "short" });
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";
  if (session.user.role === "ejecutivo") redirect("/whatsapp/chat");

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
    sentMessagesStats,
    accountsList,
    attention,
    unreadPreview,
  ] = await Promise.all([
    Promise.resolve(accountIds.length),
    countConnectedAccounts(accountIds),
    countChats(accountIds, visibility),
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
    isAdmin ? countBots(userId) : Promise.resolve(0),
    isAdmin ? countActiveBots(userId) : Promise.resolve(0),
    countCampaigns(accountIds),
    countCompletedCampaigns(accountIds),
    getSentMessagesStats(accountIds, undefined, visibility),
    prisma.wAAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
    getAttentionSummary(userId, isAdmin, visibleChatsWhere),
    prisma.wAChat.findMany({
      where: { AND: [visibleChatsWhere, { unreadCount: { gt: 0 } }] },
      orderBy: [{ lastMessageAt: "asc" }, { id: "asc" }], take: 5,
      select: { id: true, accountId: true, name: true, remoteJid: true, lastMessage: true, lastMessageAt: true, unreadCount: true, account: { select: { name: true } } },
    }),
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
      label: "Conversaciones",
      value: String(chatsTotal),
      numeric: chatsTotal,
      delta: unreadCount > 0 ? `${unreadCount.toLocaleString("es-MX")} mensajes sin leer` : undefined,
      deltaTone: unreadCount > 0 ? "danger" : "neutral",
      hint: "conversaciones",
      href: "/whatsapp/chat",
    },
    ...(isAdmin ? [{
      label: "Bots IA",
      value: botsTotal === 0 ? "0" : `${botsActive}/${botsTotal}`,
      hint: "activos",
      href: "/whatsapp/bots",
    }] : []),
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
        <PageHeader title="Panel" description="Tus pendientes, el estado de tus cuentas y la actividad de tu equipo." />
      </div>

      <div className="animate-fade-in-up animation-delay-100">
        <KpiStrip items={kpis} />
      </div>

      <section className="animate-fade-in-up animation-delay-100 space-y-4">
        <SectionHeader eyebrow="Tu operación" title="Por atender" action={<Link href="/whatsapp/chat" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">Abrir bandeja <ArrowRight size={14} /></Link>} />
        <div className={`grid grid-cols-2 gap-3 ${isAdmin ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
          {[
            { label: "Conversaciones sin leer", value: attention.unreadChats, hint: "Abre primero las más antiguas", href: "/whatsapp/chat?triage=unread", Icon: Inbox, tone: "text-accent" },
            { label: "En seguimiento", value: attention.pendingChats, hint: "Marcadas como pendientes", href: "/whatsapp/chat?triage=pending", Icon: Clock, tone: "text-warning" },
            { label: "Envíos fallidos", value: attention.failedSends, hint: "Mensajes de los últimos 7 días", href: "/whatsapp/chat?triage=failed", Icon: AlertTriangle, tone: attention.failedSends ? "text-danger" : "text-muted" },
            ...(isAdmin ? [{ label: "Bots que requieren atención", value: attention.botErrors, hint: "Habilitados, con estado de error", href: "/whatsapp/bots", Icon: Bot, tone: attention.botErrors ? "text-danger" : "text-muted" }] : []),
          ].map(({ label, value, hint, href, Icon, tone }) => <Card key={label} as={Link} href={href} interactive padding="sm" className="group block">
            <div className="flex items-start justify-between gap-3"><Icon size={19} className={tone} /><ArrowRight size={15} className="text-muted-darker group-hover:text-accent" /></div>
            <p className="font-mono text-3xl mt-5 mb-2">{value.toLocaleString("es-MX")}</p>
            <h3 className="text-sm font-medium leading-snug">{label}</h3><p className="text-xs text-muted mt-1">{hint}</p>
          </Card>)}
        </div>
        {accountsTotal > accountsConnected && <Banner tone="warning" title="Revisa la conexión de tus números">Hay {accountsTotal - accountsConnected} cuenta(s) que no figuran conectadas. <Link href="/whatsapp/cuentas" className="text-accent underline">Ver cuentas</Link></Banner>}
      </section>

      <Workbench>
        <WorkbenchMain>
          <section className="mb-10 space-y-3">
            <SectionHeader eyebrow="Bandeja" title="Sin leer, de mayor antigüedad" />
            {unreadPreview.length === 0 ? <Banner tone="success" title="Tu bandeja está al día">No tienes conversaciones con mensajes sin leer.</Banner> : <div className="divide-y divide-border">
              {unreadPreview.map((chat) => <Link key={chat.id} href={`/whatsapp/chat/${chat.accountId}/${chat.id}?triage=unread`} className="flex items-center gap-3 py-4 hover:bg-surface/60 transition-colors">
                <EntityAvatar id={chat.accountId} name={chat.name || chat.remoteJid} size="sm" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{chat.name || chat.remoteJid.split("@")[0]}</p><p className="text-sm text-muted truncate mt-0.5">{chat.lastMessage || "Mensaje multimedia"}</p><p className="text-xs text-muted-darker mt-1">{chat.account.name}</p></div>
                <div className="shrink-0 text-right space-y-1"><Badge tone="accent" size="sm">{chat.unreadCount} sin leer</Badge><p className="font-mono text-xs text-muted">{formatTime(chat.lastMessageAt)}</p></div>
              </Link>)}
            </div>}
          </section>
          <div className="animate-fade-in-up animation-delay-200">
            <MessagesSentCard accounts={accountsList} initialStats={sentMessagesStats} />
          </div>

          <section className="mt-10 animate-fade-in-up animation-delay-300">
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
          <section className="mb-10 space-y-4">
            <SectionHeader eyebrow="Estado" title="Pulso del sistema" />
            <div className="flex items-center gap-3 text-sm"><Activity size={17} className="text-accent" /><span className="flex-1">Números conectados</span><span className="font-mono">{accountsConnected}/{accountsTotal}</span></div>
            {isAdmin && <>
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex justify-between gap-3 text-sm"><span>IA · este mes</span><span className="font-mono">${attention.monthlyCost.toFixed(2)} USD</span></div>
                {attention.budget ? <><Progress value={Math.round(attention.monthlyCost / attention.budget * 100)} label="Presupuesto mensual" /><p className="text-xs text-muted">Límite: <span className="font-mono">${attention.budget.toFixed(2)} USD</span></p></> : <p className="text-xs text-muted">Sin límite mensual configurado.</p>}
                <Link href="/configuracion/ia" className="inline-flex text-sm text-accent hover:underline">Revisar consumo y presupuesto →</Link>
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 text-sm"><DatabaseBackup size={16} className="text-muted" /><span>Último respaldo completado</span></div>
                <p className="font-mono text-xs text-muted mt-2">{attention.lastBackup ? formatDate(attention.lastBackup, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sin respaldos completados"}</p>
                <Link href="/configuracion/backups" className="inline-flex mt-2 text-sm text-accent hover:underline">Ver respaldos →</Link>
              </div>
            </>}
          </section>
          <section className="animate-fade-in-up animation-delay-300">
            <SectionHeader eyebrow="Atajos" title="Acceso rápido" />

            <div className="mt-3 divide-y divide-border">
              {isAdmin && <Link
                href="/whatsapp/cuentas?nueva=1"
                className="flex items-center gap-3 py-3.5 transition-colors hover:bg-surface/60"
              >
                <IconBox icon={Plus} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Agregar número</p>
                  <p className="truncate text-xs text-muted-darker">Conectar cuenta WhatsApp Business</p>
                </div>
              </Link>}

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
                  <p className="truncate text-xs text-muted-darker">Administrar perfil y preferencias</p>
                </div>
              </Link>
            </div>
          </section>
        </WorkbenchAside>
      </Workbench>
    </div>
  );
}
