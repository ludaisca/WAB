"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, MessageSquare } from "lucide-react";
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

export default function ChatDetailPage() {
  const params = useParams();
  const { error: toastError } = useToast();
  const chatId = params.chatId as string;

  const [chat, setChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats?accountId=${params.accountId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const found = data.find((c: ChatItem) => c.id === chatId);
        if (found) setChat(found);
      }
    } catch {
      toastError("Error al cargar chat");
    } finally {
      setLoadingChat(false);
    }
  }, [chatId, params.accountId, toastError]);

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/messages?limit=50`);
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch {
      toastError("Error al cargar mensajes");
    } finally {
      setLoadingMessages(false);
    }
  }, [chatId, toastError]);

  useEffect(() => {
    fetchChat();
    fetchMessages();
  }, [fetchChat, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "text", body: newMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al enviar");
      setMessages((prev) => [...prev, data]);
      setNewMessage("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  if (loadingChat) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] -m-4 md:-m-6 lg:-m-8">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0">
        <Link
          href="/whatsapp/chat"
          className="text-muted-darker hover:text-foreground transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">
            {chat?.name ?? chat?.remoteJid ?? "Chat"}
          </p>
          {chat?.account.phoneNumber && (
            <p className="text-[11px] text-muted-darker truncate">
              {chat.account.name} · {chat.account.phoneNumber}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
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
    </div>
  );
}
