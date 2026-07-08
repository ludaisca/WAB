"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, Send, ArrowLeft, MessageSquare } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useToast } from "@/app/components/ui/toast";

interface ChatItem {
  id: string;
  accountId: string;
  remoteJid: string;
  name: string | null;
  isGroup: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  account: { id: string; name: string; phoneNumber: string | null };
}

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  body: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  status: string | null;
  timestamp: string;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function MessageBubble({ msg }: { msg: Message }) {
  const isInbound = msg.direction === "INBOUND";
  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isInbound
            ? "bg-surface text-foreground rounded-tl-sm"
            : "bg-accent text-on-accent rounded-tr-sm"
        }`}
      >
        {msg.body ?? (msg.mediaId ? `[${msg.messageType}]` : "")}
        <div className={`flex items-center justify-end gap-1 mt-1 ${
          isInbound ? "text-muted-darker" : "text-on-accent/70"
        }`}>
          <span className="text-[10px]">{formatTime(msg.timestamp)}</span>
          {!isInbound && msg.status && (
            <span className="text-[10px]">
              {msg.status === "sent" && "✓"}
              {msg.status === "delivered" && "✓✓"}
              {msg.status === "read" && "✓✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedAccountId = searchParams.get("accountId");
  const { error: toastError } = useToast();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await fetch("/api/whatsapp/chats");
      const data = await res.json();
      if (Array.isArray(data)) setChats(data);
    } catch {
      toastError("Error al cargar chats");
    } finally {
      setLoadingChats(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (!selectedChatId) return;
    setLoadingMessages(true);
    setSelectedChat(chats.find((c) => c.id === selectedChatId) ?? null);

    async function load() {
      try {
        const res = await fetch(`/api/whatsapp/chats/${selectedChatId}/messages?limit=50`);
        const data = await res.json();
        if (Array.isArray(data)) setMessages(data);
      } catch {
        toastError("Error al cargar mensajes");
      } finally {
        setLoadingMessages(false);
      }
    }
    load();
  }, [selectedChatId, chats, toastError]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!selectedChatId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/whatsapp/chats/${selectedChatId}/messages?limit=50`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setMessages(data);
          fetchChats();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedChatId, fetchChats]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChatId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${selectedChatId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text", body: newMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al enviar");
      setMessages((prev) => [...prev, data]);
      setNewMessage("");
      fetchChats();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  const filteredChats = chats.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.name?.toLowerCase().includes(q)) ||
      c.remoteJid.includes(q) ||
      c.lastMessage?.toLowerCase().includes(q)
    );
  });

  const groupedChats: Record<string, ChatItem[]> = {};
  for (const c of filteredChats) {
    const key = c.account.id;
    if (!groupedChats[key]) groupedChats[key] = [];
    groupedChats[key].push(c);
  }

  const selectedMessages = messages;

  return (
    <div className="flex h-[calc(100vh-9rem)] -m-4 md:-m-6 lg:-m-8">
      <div className={`${selectedChatId ? "hidden md:flex" : "flex"} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-border shrink-0`}>
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold tracking-tight mb-3">Chats</h1>
          <Input
            icon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar chat..."
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="py-8">
              <EmptyState
                icon={MessageSquare}
                title="Sin chats"
                description={chats.length === 0 ? "No tienes chats activos. Cuando recibas mensajes aparecerán aquí." : "No se encontraron chats con ese filtro."}
              />
            </div>
          ) : (
            <div>
              {Object.entries(groupedChats).map(([accountId, accountChats]) => (
                <div key={accountId}>
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-darker bg-surface/50 border-b border-border">
                    {accountChats[0]?.account?.name ?? accountId}
                  </div>
                  {accountChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedChatId(chat.id)}
                      className={`w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-surface-light ${
                        selectedChatId === chat.id ? "bg-surface-light" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {chat.name ?? chat.remoteJid}
                          </p>
                          <p className="text-xs text-muted-darker truncate mt-0.5">
                            {chat.lastMessage ?? "Sin mensajes"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {chat.lastMessageAt && (
                            <span className="text-[10px] text-muted-darker">
                              {formatTime(chat.lastMessageAt)}
                            </span>
                          )}
                          {chat.unreadCount > 0 && (
                            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold">
                              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`${selectedChatId ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0 bg-background`}>
        {!selectedChatId ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Selecciona un chat"
              description={chats.length === 0 ? "Conecta una cuenta de WhatsApp para empezar a recibir mensajes." : "Elige una conversación de la lista para ver los mensajes."}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0">
              <button
                onClick={() => { setSelectedChatId(null); setSelectedChat(null); }}
                className="md:hidden text-muted-darker hover:text-foreground transition-colors"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {selectedChat?.name ?? selectedChat?.remoteJid ?? "Chat"}
                </p>
                {selectedChat?.account.phoneNumber && (
                  <p className="text-[11px] text-muted-darker truncate">
                    {selectedChat.account.name} · {selectedChat.account.phoneNumber}
                  </p>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner />
                </div>
              ) : selectedMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <EmptyState icon={MessageSquare} title="Sin mensajes" description="Aún no hay mensajes en este chat." />
                </div>
              ) : (
                selectedMessages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="flex items-end gap-2 px-4 py-3 border-t border-border bg-surface shrink-0">
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Escribe un mensaje..."
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted-darker focus:outline-none focus:ring-2 focus:ring-accent/40 transition-colors"
                disabled={sending}
              />
              <Button
                type="submit"
                icon={sending ? undefined : Send}
                size="sm"
                disabled={!newMessage.trim() || sending}
              >
                {sending ? <Spinner /> : ""}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
