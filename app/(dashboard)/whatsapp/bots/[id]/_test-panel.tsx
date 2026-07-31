"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, MessageSquare, Trash2, Send } from "lucide-react";
import { Workbench, WorkbenchMain, WorkbenchAside } from "@/app/components/ui/workbench";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { AgentMessageBubble } from "@/app/components/ui/agent-message-bubble";
import { useToast } from "@/app/components/ui/toast";
import { cn } from "@/app/components/ui/cn";

interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TestMessageRow {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}

// Conversaciones de prueba persistentes — calcado del patrón del Asistente IA
// (app/(dashboard)/asistente-ia/_view.tsx: sidebar de conversaciones + panel
// de chat), sin el mecanismo de confirmación de acciones (AgentAction) que no
// aplica acá: probar un bot no ejecuta nada real.
export function TestPanel({ botId }: { botId: string }) {
  const { error: toastError } = useToast();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TestMessageRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations`);
      const data = await res.json();
      if (Array.isArray(data)) setConversations(data);
    } catch {
      toastError("Error al cargar conversaciones de prueba");
    } finally {
      setLoadingList(false);
    }
  }, [botId, toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConversation(true);
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations/${id}`);
      if (!res.ok) throw new Error("No se pudo cargar la conversación");
      const data = await res.json();
      setMessages(data.messages);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cargar la conversación");
    } finally {
      setLoadingConversation(false);
    }
  }, [botId, toastError]);

  function selectConversation(id: string) {
    setSelectedId(id);
    loadConversation(id);
  }

  async function newConversation() {
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations`, { method: "POST" });
      if (!res.ok) throw new Error("No se pudo crear la conversación");
      const conv = await res.json();
      setConversations((prev) => [conv, ...prev]);
      setSelectedId(conv.id);
      setMessages([]);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al crear la conversación");
    }
  }

  async function deleteConversation(id: string) {
    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar la conversación");
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar la conversación");
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    let conversationId = selectedId;
    if (!conversationId) {
      try {
        const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations`, { method: "POST" });
        if (!res.ok) throw new Error("No se pudo crear la conversación");
        const conv = await res.json();
        conversationId = conv.id;
        setConversations((prev) => [conv, ...prev]);
        setSelectedId(conv.id);
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Error al crear la conversación");
        return;
      }
    }

    setInput("");
    setSending(true);
    // Optimista: refleja el mensaje del usuario de inmediato, sin esperar la
    // respuesta completa del turno (que puede tardar varios segundos con tools).
    setMessages((prev) => [
      ...prev,
      { id: `optimistic-${Date.now()}`, role: "USER", content: text, createdAt: new Date().toISOString() },
    ]);

    try {
      const res = await fetch(`/api/whatsapp/bots/${botId}/test/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar el mensaje");

      setMessages(data.messages);
      setConversations((prev) => {
        const rest = prev.filter((c) => c.id !== conversationId);
        return [{ id: data.id, title: data.title, createdAt: data.createdAt, updatedAt: data.updatedAt }, ...rest];
      });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al enviar el mensaje");
      // Revierte el mensaje optimista si el turno completo falló.
      if (conversationId) loadConversation(conversationId);
    } finally {
      setSending(false);
    }
  }

  return (
    <Workbench>
      <WorkbenchAside className="lg:order-2">
        <SectionHeader
          title="Conversaciones"
          action={<Button size="sm" variant="ghost" icon={Plus} onClick={newConversation}>Nueva</Button>}
        />
        <div className="space-y-1">
          {!loadingList && conversations.length === 0 && (
            <p className="text-sm text-muted px-1">Todavía no hay conversaciones.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors",
                selectedId === c.id ? "bg-surface-light" : "hover:bg-surface-light/60"
              )}
              onClick={() => selectConversation(c.id)}
            >
              <span className="flex-1 min-w-0 truncate text-sm text-foreground">{c.title || "Nueva conversación"}</span>
              <button
                aria-label="Eliminar conversación"
                className="shrink-0 text-muted-darker opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity"
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </WorkbenchAside>

      <WorkbenchMain className="lg:order-1">
        <div className="flex h-[65vh] flex-col rounded-xl border border-border bg-surface">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!selectedId && messages.length === 0 && (
              <EmptyState
                icon={MessageSquare}
                title="Prueba una conversación completa"
                description="Manda varios mensajes seguidos para probar memoria, RAG y la consulta de precio, igual que en un chat real."
              />
            )}
            {loadingConversation && <p className="text-sm text-muted text-center">Cargando…</p>}
            {messages.map((m) => (
              <AgentMessageBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {sending && (
              <div className="flex justify-start">
                <p className="rounded-lg bg-surface-light px-3 py-1.5 text-sm text-muted italic animate-pulse">Pensando…</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Escribe un mensaje de prueba…"
              disabled={sending}
              className="flex-1 rounded-lg border border-border bg-surface-light px-4 py-2.5 text-sm text-foreground placeholder:text-muted-darker focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60"
            />
            <Button icon={Send} onClick={sendMessage} loading={sending} disabled={!input.trim()}>
              Enviar
            </Button>
          </div>
        </div>
      </WorkbenchMain>
    </Workbench>
  );
}
