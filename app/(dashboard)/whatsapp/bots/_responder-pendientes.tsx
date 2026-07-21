"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageCircleOff } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Badge } from "@/app/components/ui/badge";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useToast } from "@/app/components/ui/toast";

const MAX_SELECTION = 50;

interface WaBotOption {
  id: string;
  name: string;
  isActive: boolean;
  status: string;
}

interface CandidateChat {
  id: string;
  remoteJid: string;
  displayName: string;
  accountId: string;
  accountName: string;
  lastMessageAt: string;
  preview: string;
  withinServiceWindow: boolean;
}

interface ReplyResult {
  chatId: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  bots: WaBotOption[];
}

const RESULT_BADGE: Record<ReplyResult["status"], { label: string; tone: "success" | "danger" | "neutral" }> = {
  sent: { label: "Enviado", tone: "success" },
  failed: { label: "Falló", tone: "danger" },
  skipped: { label: "Omitido", tone: "neutral" },
};

export function UnassignedLeadsModal({ open, onClose, bots }: Props) {
  const { success, error: toastError } = useToast();
  const [chats, setChats] = useState<CandidateChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [botId, setBotId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [lastResults, setLastResults] = useState<ReplyResult[] | null>(null);

  const activeBots = bots.filter((b) => b.isActive && b.status === "ACTIVE");

  const fetchChats = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/bots/unassigned-leads");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar leads");
      const loaded: CandidateChat[] = data.chats;
      setChats(loaded);
      setSelected(new Set(loaded.filter((c) => c.withinServiceWindow).map((c) => c.id)));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset del resultado anterior al reabrir la modal
      setLastResults(null);
      fetchChats();
    }
  }, [open, fetchChats]);

  useEffect(() => {
    if (open && activeBots.length > 0 && !botId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preselecciona el primer bot activo disponible
      setBotId(activeBots[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr al abrir/cuando cambia la lista de bots activos, no en cada tecleo de botId
  }, [open, activeBots.length]);

  function toggle(chatId: string, withinWindow: boolean) {
    if (!withinWindow) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  async function handleSend() {
    if (!botId || selected.size === 0) return;
    setSending(true);
    setLastResults(null);
    try {
      const res = await fetch("/api/whatsapp/bots/unassigned-leads/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, chatIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al enviar");
      setLastResults(data.results);
      if (data.sentCount > 0) success(`${data.sentCount} respuesta(s) enviada(s)`);
      if (data.failedCount > 0 || data.skippedCount > 0) {
        toastError(`${data.failedCount} fallaron, ${data.skippedCount} se omitieron — revisa el detalle abajo`);
      }
      fetchChats();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  const withinWindowCount = chats.filter((c) => c.withinServiceWindow).length;
  const outsideWindowCount = chats.length - withinWindowCount;
  const overLimit = selected.size > MAX_SELECTION;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Responder leads sin bot"
      description="Leads que le escribieron a una cuenta sin bot activo y nunca recibieron respuesta."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button
            onClick={handleSend}
            disabled={sending || !botId || selected.size === 0 || overLimit || activeBots.length === 0}
          >
            {sending ? <Spinner /> : `Enviar respuestas (${selected.size})`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {fetchError && <Banner tone="danger">{fetchError}</Banner>}

        {activeBots.length === 0 ? (
          <Banner tone="warning">No tienes ningún bot activo — activa uno en la lista de bots antes de usar esto.</Banner>
        ) : (
          <FormField label="Responder con el bot">
            {(id) => (
              <Select id={id} value={botId} onChange={(e) => setBotId(e.target.value)}>
                {activeBots.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            )}
          </FormField>
        )}

        {overLimit && (
          <Banner tone="warning">
            Máximo {MAX_SELECTION} chats por envío — desmarca algunos o mándalos en varias tandas.
          </Banner>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : chats.length === 0 ? (
          <EmptyState
            icon={MessageCircleOff}
            title="Sin leads pendientes"
            description="No hay leads sin responder en cuentas sin bot activo — todo al día."
          />
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted-darker">
              <span>
                {withinWindowCount} disponibles
                {outsideWindowCount > 0 ? ` · ${outsideWindowCount} fuera de la ventana de 24h` : ""}
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(chats.filter((c) => c.withinServiceWindow).map((c) => c.id)))}
                  className="hover:text-foreground transition-colors"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="hover:text-foreground transition-colors"
                >
                  Ninguno
                </button>
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-xl border border-border">
              {chats.map((chat) => {
                const result = lastResults?.find((r) => r.chatId === chat.id);
                return (
                  <div key={chat.id} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={selected.has(chat.id)}
                      onChange={() => toggle(chat.id, chat.withinServiceWindow)}
                      disabled={!chat.withinServiceWindow}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{chat.displayName}</span>
                        <Badge tone="neutral" size="sm">{chat.accountName}</Badge>
                        {!chat.withinServiceWindow && (
                          <Badge tone="warning" size="sm">Fuera de 24h — necesita plantilla</Badge>
                        )}
                        {result && (
                          <Badge tone={RESULT_BADGE[result.status].tone} size="sm">
                            {RESULT_BADGE[result.status].label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-darker truncate">{chat.preview}</p>
                      {result?.error && <p className="text-xs text-danger mt-0.5">{result.error}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
