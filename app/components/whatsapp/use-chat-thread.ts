"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeChatMessages } from "@/lib/whatsapp/chat-state";
import { chatJson } from "./use-chat-list";

interface ThreadMessage { id: string; timestamp: string }
interface Thread<T> { chatId: string | null; messages: T[]; loading: boolean; older: boolean; loadingOlder: boolean; error: string | null }
export function useChatThread<T extends ThreadMessage>(chatId: string | null, onChange: () => Promise<void>, beforePrepend: () => void) {
  const [state, setState] = useState<Thread<T>>({ chatId: null, messages: [], loading: false, older: false, loadingOlder: false, error: null });
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!chatId) return;
    const abort = new AbortController(); controller.current = abort;
    let lastSnapshot = "";
    let initialized = false;
    setState({ chatId, messages: [], loading: true, older: false, loadingOlder: false, error: null });
    async function load() {
      try {
        const data = await chatJson<T[]>(`/api/whatsapp/chats/${chatId}/messages?limit=50`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const snapshot = JSON.stringify(data);
        const firstLoad = !initialized;
        const changed = firstLoad || snapshot !== lastSnapshot;
        setState((prev) => {
          if (prev.chatId !== chatId) return prev;
          if (!changed && !prev.loading && !prev.error) return prev;
          return {
            ...prev, loading: false, error: null,
            messages: changed ? mergeChatMessages(prev.messages, data) : prev.messages,
            older: firstLoad ? data.length >= 50 : prev.older,
          };
        });
        if (!firstLoad && changed) void onChange();
        lastSnapshot = snapshot;
        initialized = true;
      } catch (err) {
        if (!abort.signal.aborted) setState((prev) => prev.chatId !== chatId ? prev : { ...prev, loading: false, error: err instanceof Error ? err.message : "Error al cargar mensajes" });
      } finally {
        // Schedule only after completion: slow networks cannot overlap polls.
        if (!abort.signal.aborted) timer.current = setTimeout(() => {
          if (document.hidden) scheduleVisible(); else void load();
        }, 5000);
      }
    }
    function scheduleVisible() {
      if (abort.signal.aborted) return;
      if (!document.hidden) { void load(); return; }
      timer.current = setTimeout(scheduleVisible, 5000);
    }
    void load();
    return () => { abort.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [chatId, onChange, retry]);
  const append = useCallback((targetChatId: string, message: T) => {
    setState((prev) => prev.chatId !== targetChatId ? prev : { ...prev, messages: mergeChatMessages(prev.messages, [message]) });
  }, []);
  const loadOlder = async () => {
    const oldest = state.messages[0]; const signal = controller.current?.signal;
    if (!chatId || !oldest || !signal || state.loadingOlder) return;
    setState((prev) => ({ ...prev, loadingOlder: true }));
    try {
      const data = await chatJson<T[]>(`/api/whatsapp/chats/${chatId}/messages?limit=50&before=${encodeURIComponent(oldest.timestamp)}`, { signal });
      if (signal.aborted) return;
      beforePrepend();
      setState((prev) => prev.chatId !== chatId ? prev : { ...prev, messages: mergeChatMessages(data, prev.messages), older: data.length >= 50, loadingOlder: false, error: null });
    } catch (err) {
      if (!signal.aborted) setState((prev) => prev.chatId !== chatId ? prev : { ...prev, loadingOlder: false, error: err instanceof Error ? err.message : "Error al cargar historial" });
    }
  };
  const current = state.chatId === chatId;
  return {
    messages: current ? state.messages : [], loading: !!chatId && (!current || state.loading),
    older: current && state.older, loadingOlder: current && state.loadingOlder,
    error: current ? state.error : null, append, loadOlder, retry: () => setRetry((prev) => prev + 1),
  };
}
