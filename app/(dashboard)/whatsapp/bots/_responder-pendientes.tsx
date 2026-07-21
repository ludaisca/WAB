"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [accountFilter, setAccountFilter] = useState("");
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset del resultado anterior y del filtro de cuenta al reabrir la modal
      setLastResults(null);
      setAccountFilter("");
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

  // Derivado de los chats ya cargados — evita un round-trip extra solo para
  // poblar un selector de cuentas que esta misma respuesta ya trae embebido.
  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of chats) seen.set(c.accountId, c.accountName);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [chats]);

  const visibleChats = accountFilter ? chats.filter((c) => c.accountId === accountFilter) : chats;

  // El envío SIEMPRE se limita a lo que el filtro deja visible — sin esto, si
  // el usuario seleccionó "Todos" y luego cambia el filtro a otra cuenta, el
  // botón mandaría también a leads de la cuenta anterior que ya no ve en
  // pantalla en ese momento.
  const visibleSelectedIds = Array.from(selected).filter((id) => visibleChats.some((c) => c.id === id));

  const withinWindowCount = visibleChats.filter((c) => c.withinServiceWindow).length;
  const outsideWindowCount = visibleChats.length - withinWindowCount;
  const overLimit = visibleSelectedIds.length > MAX_SELECTION;

  async function handleSend() {
    if (!botId || visibleSelectedIds.length === 0) return;
    setSending(true);
    setLastResults(null);
    try {
      const res = await fetch("/api/whatsapp/bots/unassigned-leads/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, chatIds: visibleSelectedIds }),
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
            disabled={sending || !botId || visibleSelectedIds.length === 0 || overLimit || activeBots.length === 0}
          >
            {sending ? <Spinner /> : `Enviar respuestas (${visibleSelectedIds.length})`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {fetchError && <Banner tone="danger">{fetchError}</Banner>}

        {activeBots.length === 0 ? (
          <Banner tone="warning">No tienes ningún bot activo — activa uno en la lista de bots antes de usar esto.</Banner>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <FormField label="Responder con el bot">
                {(id) => (
                  <Select id={id} value={botId} onChange={(e) => setBotId(e.target.value)}>
                    {activeBots.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            {accountOptions.length > 1 && (
              <div className="flex-1">
                <FormField label="Filtrar por cuenta">
                  {(id) => (
                    <Select id={id} value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                      <option value="">Todas las cuentas</option>
                      {accountOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </Select>
                  )}
                </FormField>
              </div>
            )}
          </div>
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
        ) : visibleChats.length === 0 ? (
          <EmptyState
            icon={MessageCircleOff}
            title="Sin leads en esta cuenta"
            description="Esa cuenta no tiene leads pendientes — prueba con otra o quita el filtro."
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
                  onClick={() => setSelected(new Set(visibleChats.filter((c) => c.withinServiceWindow).map((c) => c.id)))}
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
              {visibleChats.map((chat) => {
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
