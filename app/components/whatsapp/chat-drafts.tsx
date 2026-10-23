"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface ChatDraft { text: string; attachment: File | null }
interface SendState { stage: "uploading" | "sending"; error?: never }
interface FailedSend { stage?: never; error: string }
const EMPTY: ChatDraft = { text: "", attachment: null };
interface DraftContext {
  drafts: Record<string, ChatDraft>;
  sends: Record<string, SendState | FailedSend | undefined>;
  ready: boolean;
  update: (chatId: string, patch: Partial<ChatDraft>) => void;
  clearSent: (chatId: string, snapshot: ChatDraft) => void;
  begin: (chatId: string, stage: SendState["stage"]) => boolean;
  stage: (chatId: string, stage: SendState["stage"]) => void;
  finish: (chatId: string, error?: string) => void;
}
const Context = createContext<DraftContext | null>(null);

// Lives above route pages: navigation cannot discard a selected file or an
// in-flight send lock. Only text is stored, in this user's session tab.
export function ChatDraftProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const [sends, setSends] = useState<DraftContext["sends"]>({});
  const [ready, setReady] = useState(false);
  const locks = useRef(new Set<string>());
  const storageKey = `wab:chat-drafts:${userId}`;
  useEffect(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const restored = Object.fromEntries(Object.entries(raw).filter(([, text]) => typeof text === "string").map(([id, text]) => [id, { text: text as string, attachment: null }]));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate tab-local drafts only after SSR to avoid a markup mismatch.
        setDrafts(restored);
      }
    } catch { /* Storage can be disabled; navigation still retains drafts. */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.text).map(([id, draft]) => [id, draft.text]))));
    } catch { /* Best effort persistence, never block typing. */ }
  }, [drafts, ready, storageKey]);
  return <Context.Provider value={{
    drafts, sends, ready,
    update: (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...patch } })),
    clearSent: (id, snapshot) => setDrafts((prev) => {
      if (prev[id] !== snapshot) return prev;
      const next = { ...prev }; delete next[id]; return next;
    }),
    begin: (id, stage) => {
      if (locks.current.has(id)) return false;
      locks.current.add(id); setSends((prev) => ({ ...prev, [id]: { stage } })); return true;
    },
    stage: (id, stage) => setSends((prev) => ({ ...prev, [id]: { stage } })),
    finish: (id, error) => {
      locks.current.delete(id);
      setSends((prev) => ({ ...prev, [id]: error ? { error } : undefined }));
    },
  }}>{children}</Context.Provider>;
}

export function useChatDraft(chatId: string | null) {
  const context = useContext(Context);
  if (!context) throw new Error("ChatDraftProvider is required");
  return { ...context, draft: (chatId ? context.drafts[chatId] : null) ?? EMPTY, send: chatId ? context.sends[chatId] : undefined };
}
