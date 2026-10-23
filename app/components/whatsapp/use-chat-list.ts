"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeChatPages } from "@/lib/whatsapp/chat-state";

export async function chatJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) throw new Error("Tu sesión venció. Vuelve a iniciar sesión para continuar.");
    if (res.status === 503) throw new Error("El sistema está en mantenimiento. Conservamos tu borrador; intenta de nuevo al terminar.");
    throw new Error(data.error ?? "No se pudo cargar la información. Intenta de nuevo.");
  }
  return data;
}

export function useChatList<T extends { id: string }>(buildParams: (page: number, size: number) => URLSearchParams, size: number) {
  const [chats, setChats] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const loadedCount = useRef(size);
  const activeQuery = useRef<string | null>(null);
  const query = buildParams(1, size).toString();

  const load = useCallback(async (mode: "reset" | "refresh" | "more") => {
    if (activeQuery.current !== query) return;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setError(null);
    setLoading(mode === "reset"); setLoadingMore(mode === "more");
    if (mode === "reset") setChats([]);
    const count = mode === "more" || mode === "reset" ? size : Math.max(size, loadedCount.current);
    const start = mode === "more" ? loadedCount.current : 0;
    try {
      const pages: T[][] = [];
      let foundTotal = 0;
      for (let offset = start; offset < start + count; offset += 100) {
        const params = new URLSearchParams(query);
        params.set("offset", String(offset)); params.set("pageSize", String(Math.min(100, start + count - offset)));
        const data = await chatJson<{ items: T[]; total: number }>(`/api/whatsapp/chats?${params}`, { signal: controller.signal });
        pages.push(data.items); foundTotal = data.total;
        if (offset + data.items.length >= foundTotal) break;
      }
      if (controller.signal.aborted) return;
      const items = mergeChatPages(pages);
      loadedCount.current = mode === "more" ? start + items.length : items.length;
      setChats((prev) => mode === "more" ? mergeChatPages([prev, items]) : items);
      setTotal(foundTotal);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Error al cargar chats");
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [query, size]);
  useEffect(() => {
    loadedCount.current = size;
    activeQuery.current = query;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change resets the list before starting external I/O.
    void load("reset");
    return () => operation.current?.abort();
  }, [load, size, query]);
  const refresh = useCallback(() => load("refresh"), [load]);
  const more = useCallback(() => load("more"), [load]);
  return { chats, setChats, total, loading, loadingMore, error, refresh, more };
}
