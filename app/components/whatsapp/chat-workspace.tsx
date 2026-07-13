"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  Send,
  ArrowLeft,
  MessageSquare,
  User,
  StickyNote,
  Check,
  CheckCheck,
  FileAudio,
  Video,
  FileText,
  Paperclip,
  X,
  Image as ImageIcon,
} from "lucide-react";
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
  caption: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  filename: string | null;
  bytesSize: number | null;
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

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaEndpoint(messageId: string): string {
  return `/api/whatsapp/messages/${encodeURIComponent(messageId)}/media`;
}

function MediaContent({ msg }: { msg: Message }) {
  const mediaSrc = msg.mediaUrl ? mediaEndpoint(msg.id) : null;

  if (msg.messageType === "image" || msg.messageType === "sticker") {
    if (!mediaSrc) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-darker">
          <ImageIcon size={14} />
          <span>Imagen recibida</span>
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element -- proxied media, runtime URL
      <img
        src={mediaSrc}
        alt={msg.caption ?? "imagen"}
        className="max-w-full max-h-72 rounded-lg object-cover"
        loading="lazy"
      />
    );
  }

  if (msg.messageType === "audio") {
    if (!mediaSrc) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-darker">
          <FileAudio size={14} />
          <span>Audio recibido</span>
        </div>
      );
    }
    return <audio controls src={mediaSrc} className="w-full max-w-xs" />;
  }

  if (msg.messageType === "video") {
    if (!mediaSrc) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-darker">
          <Video size={14} />
          <span>Video recibido</span>
        </div>
      );
    }
    return <video controls src={mediaSrc} className="max-w-full max-h-72 rounded-lg" />;
  }

  if (msg.messageType === "document") {
    if (!mediaSrc) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-darker">
          <FileText size={14} />
          <span>{msg.filename ?? "Documento recibido"}</span>
        </div>
      );
    }
    return (
      <a
        href={mediaSrc}
        download={msg.filename ?? undefined}
        className="flex items-center gap-2 text-xs hover:underline"
      >
        <FileText size={14} />
        <span className="truncate">{msg.filename ?? "Documento"}</span>
        {msg.bytesSize ? <span className="text-muted-darker">({formatBytes(msg.bytesSize)})</span> : null}
      </a>
    );
  }

  return null;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isInbound = msg.direction === "INBOUND";
  const hasMedia = msg.messageType !== "text" && (msg.mediaUrl || msg.mediaId);
  const caption = msg.caption ?? (hasMedia && msg.body && msg.body !== `[${msg.messageType}]` ? msg.body : null);

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isInbound
            ? "bg-surface text-foreground rounded-tl-sm"
            : "bg-accent text-on-accent rounded-tr-sm"
        }`}
      >
        {hasMedia && (
          <div className="mb-1 space-y-1">
            <MediaContent msg={msg} />
            {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
          </div>
        )}
        {!hasMedia && msg.body}
        {hasMedia && !caption && !msg.body && <span className="sr-only">[{msg.messageType}]</span>}
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

interface ChatWorkspaceProps {
  initialAccountId?: string;
  initialChatId?: string;
}

export function ChatWorkspace({ initialAccountId, initialChatId }: ChatWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { error: toastError } = useToast();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [chatsTotal, setChatsTotal] = useState(0);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatId || null);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState(initialAccountId || "");
  const [statusFilter, setStatusFilter] = useState<ChatStatus | "ALL">("OPEN");
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [notesDrawerOpen, setNotesDrawerOpen] = useState(false);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseItem[]>([]);

  // Media attachments state
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const buildChatsParams = useCallback((page: number, pageSize: number): URLSearchParams => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    return params;
  }, [statusFilter]);

  const refreshChats = useCallback(async () => {
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
    }
  }, [chats.length, buildChatsParams, toastError]);

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

  // Handle URL changes to update state
  useEffect(() => {
    if (initialChatId && initialChatId !== selectedChatId) {
      setSelectedChatId(initialChatId);
    }
    if (initialAccountId && initialAccountId !== accountFilter) {
      setAccountFilter(initialAccountId);
    }
  }, [initialChatId, initialAccountId, selectedChatId, accountFilter]);

  // Load initial chats list
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

  // Sync selected chat item
  useEffect(() => {
    setSelectedChat(chats.find((c) => c.id === selectedChatId) ?? null);
  }, [selectedChatId, chats]);

  // Fetch canned responses
  useEffect(() => {
    if (!selectedChat) return;
    fetch(`/api/whatsapp/canned-responses?waAccountId=${selectedChat.accountId}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setCannedResponses(d);
      })
      .catch(() => {});
  }, [selectedChat?.accountId]);

  // Fetch messages
  useEffect(() => {
    if (!selectedChatId) return;
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Message polling
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

  // Route updates on selection
  const handleChatSelect = useCallback((chat: ChatItem) => {
    setSelectedChatId(chat.id);
    setSelectedChat(chat);
    router.push(`/whatsapp/chat/${chat.accountId}/${chat.id}`);
  }, [router]);

  const handleCloseChat = useCallback(() => {
    setSelectedChatId(null);
    setSelectedChat(null);
    clearAttachment();
    router.push("/whatsapp/chat");
  }, [router]);

  function detectMessageType(file: File): "image" | "audio" | "video" | "document" | "sticker" {
    const t = file.type.toLowerCase();
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("audio/")) return "audio";
    if (t.startsWith("video/")) return "video";
    return "document";
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toastError("El archivo supera el límite de 20MB");
      e.target.value = "";
      return;
    }
    setAttachment(file);
    setAttachmentPreview(URL.createObjectURL(file));
    e.target.value = "";
  }

  function clearAttachment() {
    setAttachment(null);
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
      setAttachmentPreview(null);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() && !attachment) return;
    if (!selectedChatId || !selectedChat) return;
    setSending(true);
    try {
      if (attachment) {
        const uploadForm = new FormData();
        uploadForm.append("file", attachment);
        uploadForm.append("accountId", selectedChat.accountId);

        const upRes = await fetch(`/api/whatsapp/media`, {
          method: "POST",
          body: uploadForm,
        });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error ?? "Error al subir el medio");

        const type = detectMessageType(attachment);
        const caption = newMessage.trim() || undefined;
        const res = await fetch(`/api/whatsapp/chats/${selectedChatId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            mediaId: upData.mediaId,
            mimeType: upData.mimeType,
            filename: upData.filename,
            caption,
            localMediaPath: upData.localMediaPath,
            bytesSize: upData.bytesSize,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error al enviar");
        setMessages((prev) => [...prev, data]);
        setNewMessage("");
        clearAttachment();
        refreshChats();
      } else {
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
      }
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
      {/* Sidebar - Chats list */}
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
                      onClick={() => handleChatSelect(chat)}
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

      {/* Main pane - Chat thread */}
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
                onClick={handleCloseChat}
                className="md:hidden text-muted-darker hover:text-foreground transition-colors"
                aria-label="Volver a la lista de chats"
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
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <EmptyState icon={MessageSquare} title="Sin mensajes" description="Aún no hay mensajes en este chat." />
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="flex flex-col gap-2 px-4 py-3 border-t border-border bg-surface shrink-0 relative">
              {cannedSuggestions.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-1.5 rounded-lg border border-border bg-surface shadow-lg overflow-hidden z-20">
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

              {attachment && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                  {attachmentPreview && attachment.type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview blob
                    <img src={attachmentPreview} alt={attachment.name} className="h-12 w-12 rounded object-cover animate-fade-in" />
                  ) : attachment.type.startsWith("audio/") ? (
                    <FileAudio size={18} className="text-muted-darker shrink-0" />
                  ) : attachment.type.startsWith("video/") ? (
                    <Video size={18} className="text-muted-darker shrink-0" />
                  ) : (
                    <FileText size={18} className="text-muted-darker shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate">{attachment.name}</p>
                    <p className="text-[11px] text-muted-darker">{(attachment.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="text-muted-darker hover:text-danger transition-colors p-1 rounded-md hover:bg-surface-light"
                    disabled={sending}
                    title="Quitar adjunto"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={onFileChosen}
                  accept="image/*,audio/*,video/*,application/pdf,text/plain"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={sending}
                  className="text-accent hover:text-accent/80 transition-colors p-2.5 rounded-lg border border-accent/30 bg-accent/10 hover:bg-accent/15 disabled:opacity-50 shrink-0 cursor-pointer"
                  title="Adjuntar medio"
                  aria-label="Adjuntar medio"
                >
                  <Paperclip size={20} />
                </button>
                <input
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
                  placeholder={attachment ? "Añadir comentario (opcional)..." : "Escribe un mensaje... (usa /atajo para respuestas rápidas)"}
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted-darker focus:outline-none focus:ring-2 focus:ring-accent/40 transition-colors"
                  disabled={sending}
                />
                <Button
                  type="submit"
                  icon={sending ? undefined : Send}
                  size="sm"
                  disabled={(!newMessage.trim() && !attachment) || sending}
                >
                  {sending ? <Spinner /> : ""}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* Drawers */}
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
