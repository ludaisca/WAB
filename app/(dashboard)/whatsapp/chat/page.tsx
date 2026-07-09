"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Send, ArrowLeft, MessageSquare, User, StickyNote, Check, CheckCheck } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useToast } from "@/app/components/ui/toast";
import { ContactDrawer } from "@/app/components/whatsapp/contact-drawer";
import { ChatAssigneePicker } from "@/app/components/whatsapp/chat-assignee-picker";
import { ChatTagPicker } from "@/app/components/whatsapp/chat-tag-picker";
import { ChatNotesDrawer } from "@/app/components/whatsapp/chat-notes-drawer";

const CHATS_PAGE_SIZE = 30;

type ChatStatus = "OPEN" | "PENDING" | "RESOLVED";

const STATUS_TABS: Array<{ key: ChatStatus | "ALL"; label: string }> = [
  { key: "OPEN", label: "Abiertos" },
  { key: "PENDING", label: "Pendientes" },
  { key: "RESOLVED", label: "Resueltos" },
  { key: "ALL", label: "Todos" },
];

const STATUS_BADGE: Record<ChatStatus, { label: string; tone: "info" | "warning" | "success" }> = {
  OPEN: { label: "Abierto", tone: "info" },
  PENDING: { label: "Pendiente", tone: "warning" },
  RESOLVED: { label: "Resuelto", tone: "success" },
};

interface ChatItem {
  id: string;
  accountId: string;
  remoteJid: string;
  name: string | null;
  isGroup: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  contactId: string | null;
  status: ChatStatus;
  assignedToId: string | null;
  assignedTo: { id: string; name: string | null } | null;
  account: { id: string; name: string; phoneNumber: string | null };
}

interface CannedResponseItem {
  id: string;
  shortcut: string;
  content: string;
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
              {msg.status === "sent" && <Check size={10} />}
              {msg.status === "delivered" && <CheckCheck size={10} />}
              {msg.status === "read" && <CheckCheck size={10} className="text-blue-300" />}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { error: toastError } = useToast();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [chatsTotal, setChatsTotal] = useState(0);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ChatStatus | "ALL">("OPEN");
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [notesDrawerOpen, setNotesDrawerOpen] = useState(false);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseItem[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const buildChatsParams = useCallback((page: number, pageSize: number): URLSearchParams => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    return params;
  }, [statusFilter]);

  // Refresca la ventana de chats actualmente visible (page=1..N ya cargadas)
  // reemplazando el array por completo — usado en polling y tras enviar/actualizar.
  const refreshChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const pageSize = Math.min(Math.max(chats.length, CHATS_PAGE_SIZE), 100);
      const res = await fetch(`/api/whatsapp/chats?${buildChatsParams(1, pageSize)}`);
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setChats(data.items);
        setChatsTotal(data.total ?? 0);
      }
    } catch {
      toastError("Error al cargar chats");
    } finally {
      setLoadingChats(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chats.length read intentionally to preserve the currently loaded window, not to retrigger on every chats change
  }, [buildChatsParams, toastError]);

  const loadMoreChats = useCallback(async () => {
    setLoadingMoreChats(true);
    try {
      const nextPage = Math.floor(chats.length / CHATS_PAGE_SIZE) + 1;
      const res = await fetch(`/api/whatsapp/chats?${buildChatsParams(nextPage, CHATS_PAGE_SIZE)}`);
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setChats((prev) => [...prev, ...data.items]);
        setChatsTotal(data.total ?? 0);
      }
    } catch {
      toastError("Error al cargar más chats");
    } finally {
      setLoadingMoreChats(false);
    }
  }, [chats.length, buildChatsParams, toastError]);

  // Se ejecuta al montar y cada vez que cambia el filtro de estado — reinicia
  // la ventana de chats cargados a la página 1 con el tamaño por defecto.
  useEffect(() => {
    async function reset() {
      setLoadingChats(true);
      try {
        const res = await fetch(`/api/whatsapp/chats?${buildChatsParams(1, CHATS_PAGE_SIZE)}`);
        const data = await res.json();
        if (Array.isArray(data.items)) {
          setChats(data.items);
          setChatsTotal(data.total ?? 0);
        }
      } catch {
        toastError("Error al cargar chats");
      } finally {
        setLoadingChats(false);
      }
    }
    reset();
  }, [buildChatsParams, toastError]);

  // Actualiza el chat seleccionado (barato, sin red) cuando cambia la selección
  // o cuando refreshChats/loadMoreChats trae datos nuevos del mismo chat.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs selectedChat with the chats list, no network involved
    setSelectedChat(chats.find((c) => c.id === selectedChatId) ?? null);
  }, [selectedChatId, chats]);

  // Precarga las respuestas rápidas de la cuenta del chat activo (una vez por
  // cuenta, no por tecla) para el autocomplete "/" del composer.
  useEffect(() => {
    if (!selectedChat) return;
    fetch(`/api/whatsapp/canned-responses?waAccountId=${selectedChat.accountId}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setCannedResponses(d);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when the account changes, not on every chats poll that recreates selectedChat
  }, [selectedChat?.accountId]);

  // Carga de mensajes: depende SOLO de selectedChatId, no del array `chats`,
  // para que el polling de la lista de chats no retrigere este fetch.
  useEffect(() => {
    if (!selectedChatId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the async message load below
    setLoadingMessages(true);

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
  }, [selectedChatId, toastError]);

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
          refreshChats();
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedChatId, refreshChats]);

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
      refreshChats();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus: ChatStatus) {
    if (!selectedChatId) return;
    try {
      const res = await fetch(`/api/whatsapp/chats/${selectedChatId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cambiar estado");
      setSelectedChat((prev) => prev && { ...prev, status: data.status });
      setChats((prev) => prev.map((c) => (c.id === selectedChatId ? { ...c, status: data.status } : c)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cambiar estado");
    }
  }

  const accountOptions = Array.from(
    new Map(chats.map((c) => [c.account.id, c.account])).values()
  );

  const filteredChats = chats.filter((c) => {
    if (accountFilter && c.accountId !== accountFilter) return false;
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

  const cannedQuery = newMessage.startsWith("/") && !newMessage.includes(" ")
    ? newMessage.slice(1).toLowerCase()
    : null;
  const cannedSuggestions = cannedQuery !== null
    ? cannedResponses.filter((c) => c.shortcut.startsWith(cannedQuery)).slice(0, 6)
    : [];

  function insertCannedResponse(content: string) {
    setNewMessage(content);
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] -m-4 md:-m-6 lg:-m-8">
      <div className={`${selectedChatId ? "hidden md:flex" : "flex"} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-border shrink-0`}>
        <div className="p-4 border-b border-border space-y-2">
          <h1 className="text-lg font-bold tracking-tight mb-1">Chats</h1>
          {accountOptions.length > 1 && (
            <Select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="">Todos los números</option>
              {accountOptions.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}{acc.phoneNumber ? ` · ${acc.phoneNumber}` : ""}
                </option>
              ))}
            </Select>
          )}
          <Input
            icon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar chat..."
          />
          <div className="flex gap-1 pt-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === tab.key
                    ? "bg-accent text-on-accent"
                    : "bg-surface-light text-muted-darker hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
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
                          {chat.assignedTo && (
                            <Badge tone="info" size="sm" className="mt-1">
                              {chat.assignedTo.name ?? "Asignado"}
                            </Badge>
                          )}
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
              {!search && !accountFilter && chats.length < chatsTotal && (
                <div className="p-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onClick={loadMoreChats}
                    disabled={loadingMoreChats}
                  >
                    {loadingMoreChats ? <Spinner /> : "Cargar más"}
                  </Button>
                </div>
              )}
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
              {selectedChat && (
                <select
                  value={selectedChat.status}
                  onChange={(e) => handleStatusChange(e.target.value as ChatStatus)}
                  className="text-xs font-medium rounded-md border border-border bg-surface-light px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                  title="Estado de la conversación"
                >
                  {(Object.keys(STATUS_BADGE) as ChatStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
                  ))}
                </select>
              )}
              {selectedChat && <ChatTagPicker key={selectedChat.id} chatId={selectedChat.id} />}
              {selectedChat && (
                <ChatAssigneePicker
                  chatId={selectedChat.id}
                  assignedTo={selectedChat.assignedTo}
                  onAssigned={(assignee) =>
                    setSelectedChat((prev) => prev && ({ ...prev, assignedTo: assignee, assignedToId: assignee?.id ?? null }))
                  }
                />
              )}
              {selectedChat && (
                <button
                  onClick={() => setNotesDrawerOpen(true)}
                  className="text-muted-darker hover:text-foreground transition-colors"
                  title="Notas internas"
                >
                  <StickyNote size={18} />
                </button>
              )}
              {selectedChat?.contactId && (
                <button
                  onClick={() => setContactDrawerOpen(true)}
                  className="text-muted-darker hover:text-foreground transition-colors"
                  title="Ver contacto"
                >
                  <User size={18} />
                </button>
              )}
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

            <form onSubmit={handleSend} className="relative flex items-end gap-2 px-4 py-3 border-t border-border bg-surface shrink-0">
              {cannedSuggestions.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-1.5 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
                  {cannedSuggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => insertCannedResponse(c.content)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-light transition-colors border-b border-border last:border-b-0"
                    >
                      <span className="font-mono text-accent">/{c.shortcut}</span>
                      <span className="text-muted-darker ml-2 truncate">{c.content}</span>
                    </button>
                  ))}
                </div>
              )}
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as unknown as React.FormEvent);
                  }
                  if (e.key === "Tab" && cannedSuggestions.length > 0) {
                    e.preventDefault();
                    insertCannedResponse(cannedSuggestions[0].content);
                  }
                }}
                placeholder="Escribe un mensaje... (usa /atajo para respuestas rápidas)"
                className="flex-1"
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

      {contactDrawerOpen && selectedChat?.contactId && (
        <ContactDrawer
          contactId={selectedChat.contactId}
          onClose={() => setContactDrawerOpen(false)}
          onUpdated={refreshChats}
        />
      )}

      {notesDrawerOpen && selectedChat && (
        <ChatNotesDrawer
          chatId={selectedChat.id}
          chatTitle={selectedChat.name ?? selectedChat.remoteJid}
          onClose={() => setNotesDrawerOpen(false)}
        />
      )}
    </div>
  );
}
