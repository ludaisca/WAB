"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, MessageSquare, Megaphone, Bot as BotIcon, DollarSign, Phone } from "lucide-react";
import { Dropdown } from "./dropdown";
import { cn } from "./cn";

interface NotificationItem {
  id: string;
  type: "CHAT_MESSAGE" | "CAMPAIGN_COMPLETED" | "CAMPAIGN_FAILED" | "BOT_ERROR" | "BUDGET_EXCEEDED" | "ACCOUNT_STATUS";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<NotificationItem["type"], React.ElementType> = {
  CHAT_MESSAGE: MessageSquare,
  CAMPAIGN_COMPLETED: Megaphone,
  CAMPAIGN_FAILED: Megaphone,
  BOT_ERROR: BotIcon,
  BUDGET_EXCEEDED: DollarSign,
  ACCOUNT_STATUS: Phone,
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/notifications?limit=20");
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items);
      if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
    } catch {
      // silent — notification polling should not surface errors to the user
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchNotifications also used for manual refresh
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const interval = setInterval(fetchNotifications, 25000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  async function handleItemClick(item: NotificationItem) {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      fetch(`/api/whatsapp/notifications/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {});
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch("/api/whatsapp/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="right"
      trigger={
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-darker transition-colors hover:bg-surface-light hover:text-foreground"
          aria-label="Notificaciones"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      }
    >
      <div className="w-80">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-darker uppercase tracking-wider">Notificaciones</span>
          {unreadCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkAllRead(); }}
              className="text-xs text-accent hover:underline"
            >
              Marcar todo como leído
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-sm text-muted-darker">Sin notificaciones</p>
          ) : (
            items.map((item) => {
              const Icon = TYPE_ICON[item.type];
              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-light",
                    !item.read && "bg-accent/5"
                  )}
                >
                  <Icon size={16} className="text-muted-darker shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate", !item.read && "font-semibold text-foreground")}>
                      {item.title}
                    </p>
                    {item.body && (
                      <p className="text-xs text-muted-darker truncate mt-0.5">{item.body}</p>
                    )}
                    <p className="text-[10px] text-muted-darker mt-0.5">{formatRelative(item.createdAt)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Dropdown>
  );
}
