"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  Send,
  ArrowLeft,
  MessageSquare,
  User,
  Check,
  CheckCheck,
  FileAudio,
  Video,
  FileText,
  Paperclip,
  X,
  Image as ImageIcon,
  Download,
  Maximize2,
  Copy,
} from "lucide-react";
import { Textarea } from "@/app/components/ui/textarea";
import { Banner } from "@/app/components/ui/banner";
import { useChatDraft } from "./chat-drafts";
import { useChatList, chatJson } from "./use-chat-list";
import { useChatThread } from "./use-chat-thread";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { Skeleton, SkeletonChatList } from "@/app/components/ui/skeleton";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Modal } from "@/app/components/ui/modal";
import { useToast } from "@/app/components/ui/toast";
import { ContactDrawer } from "@/app/components/whatsapp/contact-drawer";
import { ChatAssigneePicker } from "@/app/components/whatsapp/chat-assignee-picker";
import { ChatTagPicker } from "@/app/components/whatsapp/chat-tag-picker";
import { LeadScoreBadge } from "@/app/components/whatsapp/lead-score-badge";
import { ChatCostBadge } from "@/app/components/whatsapp/chat-cost-badge";
import { ChatPublicLinkButton } from "@/app/components/whatsapp/chat-public-link-button";
import { mediaEndpointFor, isImageMime, isAudioMime, isVideoMime } from "@/lib/whatsapp/media-shared";
import { formatBubbleTime, formatDayDivider, chatDayKey } from "@/lib/whatsapp/chat-format";
import { formatDate as formatDateTz } from "@/lib/timezone";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { hueClassFor } from "@/app/components/ui/hue";

const CHATS_PAGE_SIZE = 30;

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
  assignedToId: string | null;
  assignedTo: { id: string; name: string | null } | null;
  account: { id: string; name: string; phoneNumber: string | null };
  campaign: { id: string; name: string } | null;
  contact: { blockedAt: string | null } | null;
  // Timestamp del último mensaje ENTRANTE — define la ventana de servicio de
  // Meta (24 h). Ver isServiceWindowOpen().
  lastInboundAt?: string | null;
}

// Ventana de servicio de Meta: 24 h desde el último mensaje entrante. Fuera de
// ella la API solo acepta plantillas aprobadas, así que el composer se bloquea
// (el backend lo valida igual en chats/[chatId]/send).
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isServiceWindowOpen(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < SERVICE_WINDOW_MS;
}

interface CannedResponseItem {
  id: string;
  shortcut: string;
  content: string;
}

interface CampaignOption {
  id: string;
  name: string;
  // true = fuente de Facebook Ads (LeadSheetSource), no campaña masiva
  source?: boolean;
}

const HAS_REPLIED_OPTIONS: Array<{ value: "" | "yes" | "no"; label: string }> = [
  { value: "", label: "Todos los chats" },
  { value: "yes", label: "Con respuesta del lead" },
  { value: "no", label: "Sin respuesta del lead" },
];

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
  transcription: string | null;
  reaction: string | null;
  status: string | null;
  timestamp: string;
}

// formatBubbleTime/formatDayDivider viven en lib/whatsapp/chat-format.ts,
// compartidas con public-chat-view.tsx (link público) — ambas explícitas en
// CDMX (ver lib/timezone.ts), no en la zona del navegador.
function formatTime(ts: string): string {
  const isToday = chatDayKey(ts) === chatDayKey(new Date().toISOString());
  if (isToday) return formatBubbleTime(ts);
  return formatDateTz(ts, { day: "2-digit", month: "short" });
}

// Deterministic per-account color so the same number always reads with the
// same tone across the sidebar groups and the thread header, letting an agent
// juggling multiple WhatsApp numbers tell them apart at a glance.
const ACCOUNT_TONES = ["info", "success", "warning", "danger", "accent"] as const;
type AccountTone = (typeof ACCOUNT_TONES)[number];
function hashTone(id: string): AccountTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCOUNT_TONES[hash % ACCOUNT_TONES.length];
}
const accountTone = hashTone;
// Separate name at call sites for readability — the badge doesn't get its own
// color pool (Tailwind literals aside, 5 semantic tones is already what the
// design system offers); a campaign badge always carries its name as text, so
// a same-tone collision between two campaigns is still unambiguous.
const campaignTone = hashTone;
// El punto/nombre del grupo por cuenta usa el sistema hue-N (8 colores por
// entidad, ver lib hue.ts + globals.css) — mismo color que el EntityAvatar de
// cada fila, para que el inbox multi-cuenta se lea de un vistazo. Los Badge
// (campaña/cuenta en el header del hilo) siguen con los 5 tonos semánticos.

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PreviewMedia {
  type: "image" | "video";
  src: string;
  filename: string | null;
  mimeType: string | null;
}

function MediaContent({ msg, onPreview }: { msg: Message; onPreview: (media: PreviewMedia) => void }) {
  const mediaSrc = msg.mediaUrl ? mediaEndpointFor(msg.id) : null;

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
      <button
        type="button"
        onClick={() => onPreview({ type: "image", src: mediaSrc, filename: msg.filename, mimeType: msg.mimeType })}
        className="block cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied media, runtime URL */}
        <img
          src={mediaSrc}
          alt={msg.caption ?? "imagen"}
          className="max-w-full max-h-72 rounded-lg object-cover"
          loading="lazy"
        />
      </button>
    );
  }

  if (msg.messageType === "audio") {
    if (!mediaSrc) {
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-darker">
            <FileAudio size={14} />
            <span>Audio recibido</span>
          </div>
          {msg.transcription && (
            <p className="text-xs italic text-muted-darker whitespace-pre-wrap break-words leading-relaxed">
              {msg.transcription}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <audio controls src={mediaSrc} className="w-full max-w-xs" />
          <a
            href={mediaSrc}
            download={msg.filename ?? undefined}
            className="text-muted-darker hover:text-foreground shrink-0"
            title="Descargar audio"
          >
            <Download size={14} />
          </a>
        </div>
        {msg.transcription && (
          <p className="text-xs italic text-muted-darker whitespace-pre-wrap break-words leading-relaxed">
            {msg.transcription}
          </p>
        )}
      </div>
    );
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
    return (
      <div className="relative group max-w-full">
        <video controls src={mediaSrc} className="max-w-full max-h-72 rounded-lg" />
        <button
          type="button"
          onClick={() => onPreview({ type: "video", src: mediaSrc, filename: msg.filename, mimeType: msg.mimeType })}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white hover:bg-black/70"
          title="Ver en grande"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    );
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

function MessageBubble({
  msg,
  onPreview,
  isLatest,
}: {
  msg: Message;
  onPreview: (media: PreviewMedia) => void;
  isLatest?: boolean;
}) {
  const isInbound = msg.direction === "INBOUND";
  const hasMedia = msg.messageType !== "text" && (msg.mediaUrl || msg.mediaId);
  const caption = msg.caption ?? (hasMedia && msg.body && msg.body !== `[${msg.messageType}]` ? msg.body : null);

  return (
    // Solo el último mensaje entra animado: React conserva el DOM de los
    // anteriores por su key, así que al llegar uno nuevo únicamente ese monta y
    // anima — no se re-anima todo el hilo en cada poll ni al cargar.
    <div
      className={`flex ${isInbound ? "justify-start" : "justify-end"} ${
        isLatest ? "animate-slide-up" : ""
      }`}
    >
      {/* relative: el chip de reacción se ancla a la burbuja, no a la fila
          completa (que ocupa el ancho libre por el justify-start/end de arriba). */}
      <div className="relative max-w-[75%]">
        <div
          className={`px-3.5 py-2.5 text-sm leading-relaxed ${
            isInbound
              ? "rounded-2xl rounded-tl-sm bg-surface text-foreground"
              : "rounded-bubble-br bg-accent text-on-accent"
          }`}
        >
          {hasMedia && (
            <div className="mb-1 space-y-1">
              <MediaContent msg={msg} onPreview={onPreview} />
              {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
            </div>
          )}
          {!hasMedia && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
          {hasMedia && !caption && !msg.body && <span className="sr-only">[{msg.messageType}]</span>}
          <div className={`flex items-center justify-end gap-1 mt-1 ${
            isInbound ? "text-muted-darker" : "text-on-accent/70"
          }`}>
            <span className="text-xs">{formatBubbleTime(msg.timestamp)}</span>
            {!isInbound && msg.status && (
              <span className="text-xs">
                {msg.status === "sent" && <Check size={10} />}
                {msg.status === "delivered" && <CheckCheck size={10} />}
                {/* El salto entregado→leído monta un elemento nuevo, así que el
                    micro-pop marca el cambio de estado sin ser intrusivo. */}
                {msg.status === "read" && <CheckCheck size={10} className="text-info animate-scale-in-spring" />}
              </span>
            )}
          </div>
        </div>
        {/* Emoji con el que el lead reaccionó a este mensaje (webhook
            type: "reaction" — ver applyReaction en el route del webhook). Chip
            asomando en la esquina opuesta al pico de la burbuja, mismo lugar
            donde WhatsApp lo muestra. animate-scale-in-spring: distingue una
            reacción nueva llegando por el poll de 5s de una que ya estaba ahí. */}
        {msg.reaction && (
          <span
            className={`absolute -bottom-2 ${isInbound ? "right-0" : "left-0"} flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-light px-1 text-xs shadow-sm ring-1 ring-border animate-scale-in-spring`}
            title="Reacción del contacto"
          >
            {msg.reaction}
          </span>
        )}
      </div>
    </div>
  );
}

function MediaPreviewModal({ media, onClose }: { media: PreviewMedia | null; onClose: () => void }) {
  return (
    <Modal
      open={!!media}
      onClose={onClose}
      size="lg"
      title={media?.filename ?? (media?.type === "image" ? "Imagen" : "Video")}
      footer={
        media && (
          <Button
            href={media.src}
            external
            icon={Download}
            variant="secondary"
            {...{ download: media.filename ?? "" }}
          >
            Descargar
          </Button>
        )
      }
    >
      {media?.type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxied media, runtime URL
        <img src={media.src} alt={media.filename ?? "imagen"} className="max-h-[70vh] w-auto mx-auto rounded-lg" />
      ) : media ? (
        <video src={media.src} controls autoPlay className="max-h-[70vh] w-full rounded-lg" />
      ) : null}
    </Modal>
  );
}

interface ChatWorkspaceProps {
  initialAccountId?: string;
  initialChatId?: string;
  initialCampaignId?: string;
  initialHasReplied?: "" | "yes" | "no";
  initialSearch?: string;
  initialTriage?: string;
}

export function ChatWorkspace({
  initialAccountId,
  initialChatId,
  initialCampaignId,
  initialHasReplied,
  initialSearch,
  initialTriage,
}: ChatWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { success, error: toastError } = useToast();

  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatId || null);
  const drafts = useChatDraft(selectedChatId);
  const { draft, send } = drafts;
  const newMessage = draft.text;
  const attachment = draft.attachment;
  const sending = !!send?.stage;
  const setNewMessage = (text: string) => { if (selectedChatId) drafts.update(selectedChatId, { text }); };
  const [triageFilter, setTriageFilter] = useState(initialTriage || "");
  const [search, setSearch] = useState(initialSearch || "");
  // La búsqueda va al servidor (la lista está paginada — filtrar solo lo
  // cargado escondía chats antiguos); el debounce evita un fetch por tecla.
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || "");
  const [accountFilter, setAccountFilter] = useState(initialAccountId || "");
  const [campaignFilter, setCampaignFilter] = useState(initialCampaignId || "");
  const [hasRepliedFilter, setHasRepliedFilter] = useState<"" | "yes" | "no">(initialHasReplied || "");
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; phoneNumber: string | null }>>([]);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseItem[]>([]);
  // Sugerencia de respuesta rápida resaltada — navegable con ↑/↓, se inserta
  // con Enter o Tab.
  const [cannedIndex, setCannedIndex] = useState(0);

  // Media attachments state
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // scrollHeight previo a un prepend de historial — permite restaurar la
  // posición de lectura en vez de que el contenido "salte" hacia abajo.
  const prependHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const buildChatsParams = useCallback((page: number, pageSize: number): URLSearchParams => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (triageFilter) params.set("triage", triageFilter);
    if (campaignFilter) params.set("campaignId", campaignFilter);
    if (hasRepliedFilter) params.set("hasReplied", hasRepliedFilter);
    if (accountFilter) params.set("accountId", accountFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params;
  }, [campaignFilter, hasRepliedFilter, accountFilter, debouncedSearch, triageFilter]);

  const { chats, setChats, total: chatsTotal, loading: loadingChats, loadingMore: loadingMoreChats, error: chatsError, refresh: refreshChats, more: loadMoreChats } = useChatList<ChatItem>(buildChatsParams, CHATS_PAGE_SIZE);
  const { messages, loading: loadingMessages, older: hasOlderMessages, loadingOlder, error: messagesError, append: appendMessage, loadOlder: loadOlderMessages, retry: retryMessages } = useChatThread<Message>(selectedChatId, refreshChats, () => {
    prependHeightRef.current = messagesContainerRef.current?.scrollHeight ?? null;
  });
  const mounted = useRef(false);
  const refreshRef = useRef(refreshChats);
  useEffect(() => { refreshRef.current = refreshChats; }, [refreshChats]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the selected File with its revocable browser object URL.
    if (!attachment) { setAttachmentPreview(null); return; }
    const url = URL.createObjectURL(attachment);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  // Handle URL changes to update state — tracked via a "previous prop" render-time
  // comparison (same idiom as Modal/Drawer's open/prevOpen) instead of an effect,
  // since calling setState directly in an effect body causes an extra cascading
  // render for what's really just deriving state from a changed prop.
  const [prevInitialChatId, setPrevInitialChatId] = useState(initialChatId);
  const [prevInitialAccountId, setPrevInitialAccountId] = useState(initialAccountId);
  const [prevInitialCampaignId, setPrevInitialCampaignId] = useState(initialCampaignId);
  const [prevInitialHasReplied, setPrevInitialHasReplied] = useState(initialHasReplied);
  const [prevInitialSearch, setPrevInitialSearch] = useState(initialSearch);
  const [prevInitialTriage, setPrevInitialTriage] = useState(initialTriage);
  if (initialTriage !== prevInitialTriage) { setPrevInitialTriage(initialTriage); setTriageFilter(initialTriage || ""); }
  if (initialChatId !== prevInitialChatId) {
    setPrevInitialChatId(initialChatId);
    if (initialChatId) setSelectedChatId(initialChatId);
  }
  if (initialAccountId !== prevInitialAccountId) {
    setPrevInitialAccountId(initialAccountId);
    if (initialAccountId) setAccountFilter(initialAccountId);
  }
  if (initialCampaignId !== prevInitialCampaignId) {
    setPrevInitialCampaignId(initialCampaignId);
    setCampaignFilter(initialCampaignId || "");
  }
  if (initialHasReplied !== prevInitialHasReplied) {
    setPrevInitialHasReplied(initialHasReplied);
    setHasRepliedFilter(initialHasReplied || "");
  }
  if (initialSearch !== prevInitialSearch) {
    setPrevInitialSearch(initialSearch);
    setSearch(initialSearch || "");
    setDebouncedSearch(initialSearch || "");
  }

  // Refleja los filtros activos en la URL (query string) para que sobrevivan
  // tanto al botón "volver" propio (handleCloseChat) como al atrás del
  // navegador — antes vivían solo en useState y se perdían apenas se navegaba
  // a la ruta del chat individual, que monta una instancia nueva del componente.
  const buildFilterSearchParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (accountFilter) params.set("accountId", accountFilter);
    if (triageFilter) params.set("triage", triageFilter);
    if (campaignFilter) params.set("campaignId", campaignFilter);
    if (hasRepliedFilter) params.set("hasReplied", hasRepliedFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params;
  }, [accountFilter, campaignFilter, hasRepliedFilter, debouncedSearch, triageFilter]);

  useEffect(() => {
    const qs = buildFilterSearchParams().toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo resincroniza cuando cambian los filtros, no en cada render por pathname/router
  }, [accountFilter, campaignFilter, hasRepliedFilter, debouncedSearch, triageFilter]);

  // Campaign list for the filter dropdown — fetched once, doesn't depend on the
  // current chat filters.
  useEffect(() => {
    // Campañas masivas + fuentes de Facebook Ads: el badge de cada chat ya muestra
    // ambas, así que el filtro debe poder elegir ambas. Las fuentes 403 para el rol
    // ejecutivo — ahí simplemente no aparece el grupo.
    const load = (url: string, source: boolean) =>
      fetch(url)
        .then((r) => r.json())
        .then((d): CampaignOption[] =>
          Array.isArray(d) ? d.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name, source })) : []
        )
        .catch((): CampaignOption[] => []);
    Promise.all([load("/api/whatsapp/campaigns", false), load("/api/whatsapp/lead-sheet-sources", true)]).then(
      ([manual, sources]) => setCampaigns([...manual, ...sources])
    );
  }, []);

  // Cuentas para el selector — de la API, no derivadas de los chats cargados:
  // con el filtro de cuenta server-side, los chats en memoria pueden ser de
  // una sola cuenta y el selector perdería las demás opciones.
  useEffect(() => {
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setAccounts(d.map((a: { id: string; name: string; phoneNumber: string | null }) => ({
            id: a.id, name: a.name, phoneNumber: a.phoneNumber ?? null,
          })));
        }
      })
      .catch(() => {});
  }, []);

  // Resolve deep links independently from the loaded or filtered rail.
  const [chatDetail, setChatDetail] = useState<ChatItem | null>(null);
  const [chatDetailError, setChatDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  useEffect(() => {
    if (!selectedChatId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- discard errors from the previous route before requesting this chat.
    setChatDetailError(null);
    chatJson<{ items: ChatItem[] }>(`/api/whatsapp/chats?page=1&pageSize=1&chatId=${encodeURIComponent(selectedChatId)}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) {
        if (!data.items[0]) throw new Error("Esta conversación ya no está disponible para tu cuenta.");
        setChatDetail(data.items[0]);
      } })
      .catch((err) => { if (!controller.signal.aborted) setChatDetailError(err instanceof Error ? err.message : "No se pudo cargar la conversación"); });
    return () => controller.abort();
  }, [selectedChatId, detailRetry]);
  const selectedChat = chats.find((c) => c.id === selectedChatId) ?? (chatDetail?.id === selectedChatId ? chatDetail : null);
  const serviceWindowOpen = isServiceWindowOpen(selectedChat?.lastInboundAt);

  // Scope quick replies to the current account, including late responses.
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- never offer quick replies from a different account while its request is pending.
    setCannedResponses([]);
    if (selectedChat?.accountId) {
      chatJson<CannedResponseItem[]>(`/api/whatsapp/canned-responses?waAccountId=${selectedChat.accountId}`, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted && Array.isArray(data)) setCannedResponses(data); })
        .catch((err) => { if (!controller.signal.aborted) console.warn("No se pudieron cargar las respuestas rápidas", err); });
    }
    return () => controller.abort();
  }, [selectedChat?.accountId]);

  // Scroll to bottom on new messages — but only if the user was already near the
  // bottom, so the 5s poll below doesn't yank someone reading older history back
  // down every time it silently no-ops on an unchanged message list.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // Tras prepender historial, se restaura la posición de lectura en lugar
    // de auto-scrollear al fondo.
    if (prependHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Route updates on selection
  const handleChatSelect = useCallback((chat: ChatItem) => {
    setSelectedChatId(chat.id);
    const qs = buildFilterSearchParams().toString();
    router.push(`/whatsapp/chat/${chat.accountId}/${chat.id}${qs ? `?${qs}` : ""}`);
  }, [router, buildFilterSearchParams]);

  const clearAttachment = () => {
    if (selectedChatId) drafts.update(selectedChatId, { attachment: null });
  };

  const copyLeadPhone = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      success("Número copiado");
    } catch {
      toastError("No se pudo copiar el número");
    }
  }, [success, toastError]);

  const handleCloseChat = useCallback(() => {
    setSelectedChatId(null);
    const qs = buildFilterSearchParams().toString();
    router.push(`/whatsapp/chat${qs ? `?${qs}` : ""}`);
  }, [router, buildFilterSearchParams]);

  function detectMessageType(file: File): "image" | "audio" | "video" | "document" | "sticker" {
    if (isImageMime(file.type)) return "image";
    if (isAudioMime(file.type)) return "audio";
    if (isVideoMime(file.type)) return "video";
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
    if (selectedChatId) drafts.update(selectedChatId, { attachment: file });
    e.target.value = "";
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !selectedChatId || !selectedChat || !drafts.ready) return;
    // Fuera de la ventana de 24 h Meta rechaza el texto libre/media; el backend
    // devuelve 409 igual, pero no dejamos gastar el intento ni el adjunto.
    if (!serviceWindowOpen) return;
    const targetId = selectedChatId;
    const snapshot = draft;
    if (!drafts.begin(targetId, attachment ? "uploading" : "sending")) return;
    try {
      let payload: Record<string, unknown> = { type: "text", body: snapshot.text.trim() };
      if (snapshot.attachment) {
        const uploadForm = new FormData();
        uploadForm.append("file", snapshot.attachment);
        uploadForm.append("accountId", selectedChat.accountId);
        const upData = await chatJson<{ mediaId: string; mimeType: string; filename: string; localMediaPath: string; bytesSize: number }>("/api/whatsapp/media", { method: "POST", body: uploadForm });
        drafts.stage(targetId, "sending");
        payload = { type: detectMessageType(snapshot.attachment), ...upData, caption: snapshot.text.trim() || undefined };
      }
      const data = await chatJson<Message>(`/api/whatsapp/chats/${targetId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      drafts.clearSent(targetId, snapshot);
      drafts.finish(targetId);
      if (mounted.current) { appendMessage(targetId, data); void refreshRef.current(); }
    } catch (err) {
      drafts.finish(targetId, err instanceof Error ? err.message : "No se pudo confirmar el envío. Revisa la conversación antes de intentar de nuevo.");
    }
  }

  const accountOptions = accounts.length > 0
    ? accounts
    : Array.from(new Map(chats.map((c) => [c.account.id, c.account])).values());

  // El servidor ya aplica cuenta + búsqueda (debounced); este filtro replica el
  // criterio en el cliente solo para dar respuesta instantánea mientras el
  // debounce/fetch está en vuelo.
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
    setCannedIndex(0);
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar - Chats list */}
      <div className={`${selectedChatId ? "hidden md:flex" : "flex"} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-border shrink-0`}>
        <div className="p-4 border-b border-border space-y-2">
          <h1 className="text-lg font-bold tracking-tight mb-1">Chats</h1>
          {chatsError && <Banner tone="warning"><span>{chatsError}</span> <Button variant="link" size="sm" onClick={refreshChats}>Reintentar</Button></Banner>}
          <Select aria-label="Pendientes de la bandeja" value={triageFilter} onChange={(e) => setTriageFilter(e.target.value)}>
            <option value="">Toda la bandeja</option>
            <option value="unread">Conversaciones sin leer</option>
            <option value="pending">En seguimiento</option>
            <option value="failed">Con envíos fallidos · últimos 7 días</option>
          </Select>
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
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="text-xs"
            >
              <option value="">Todas las campañas</option>
              <optgroup label="Campañas">
                {campaigns.filter((c) => !c.source).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              {campaigns.some((c) => c.source) && (
                <optgroup label="Facebook Ads">
                  {campaigns.filter((c) => c.source).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </Select>
            <Select
              value={hasRepliedFilter}
              onChange={(e) => setHasRepliedFilter(e.target.value as "" | "yes" | "no")}
              className="text-xs"
            >
              {HAS_REPLIED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            // Skeleton con la forma real de la lista (avatar + 2 líneas) en vez
            // de un spinner: la transición a los datos no reacomoda el panel.
            <div className="p-2">
              <SkeletonChatList rows={8} />
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
                  <div className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-darker bg-surface/50 border-b border-border ${hueClassFor(accountId)}`}>
                    <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-entity animate-pulse-live" />
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
                        <EntityAvatar
                          id={chat.accountId}
                          name={chat.name ?? chat.remoteJid}
                          size="sm"
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {chat.name ?? chat.remoteJid}
                          </p>
                          <p className="text-xs text-muted-darker truncate mt-0.5">
                            {chat.lastMessage ?? "Sin mensajes"}
                          </p>
                          {(chat.assignedTo || chat.campaign || chat.contact?.blockedAt) && (
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {chat.contact?.blockedAt && (
                                <Badge tone="danger" size="sm">Bloqueado</Badge>
                              )}
                              {chat.assignedTo && (
                                <Badge tone="info" size="sm">
                                  {chat.assignedTo.name ?? "Asignado"}
                                </Badge>
                              )}
                              {chat.campaign && (
                                <Badge tone={campaignTone(chat.campaign.id)} size="sm" className="max-w-[10rem] truncate">
                                  {chat.campaign.name}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {chat.lastMessageAt && (
                            <span className="text-xs text-muted-darker">
                              {formatTime(chat.lastMessageAt)}
                            </span>
                          )}
                          {chat.unreadCount > 0 && (
                            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-accent text-on-accent text-xs font-bold">
                              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {chats.length < chatsTotal && (
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
            <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-surface shrink-0">
              {/* Row 1: identity — name/account always get room, icon actions stay put */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCloseChat}
                  className="md:hidden text-muted-darker hover:text-foreground transition-colors shrink-0"
                  aria-label="Volver a la lista de chats"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">
                      {selectedChat?.name ?? selectedChat?.remoteJid ?? "Chat"}
                    </p>
                    {selectedChat && (
                      <span className="flex items-center gap-1 shrink-0">
                        <span
                          className="font-mono text-xs text-muted-darker select-all cursor-text"
                          title="Número del lead — selecciona para copiar"
                        >
                          {selectedChat.remoteJid.split("@")[0]}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyLeadPhone(selectedChat.remoteJid.split("@")[0])}
                          className="text-muted-darker hover:text-foreground transition-colors"
                          title="Copiar número"
                          aria-label="Copiar número del lead"
                        >
                          <Copy size={12} />
                        </button>
                      </span>
                    )}
                    {selectedChat && (
                      <Badge tone={accountTone(selectedChat.accountId)} size="sm" className="shrink-0">
                        {selectedChat.account.name}
                      </Badge>
                    )}
                  </div>
                  {selectedChat?.account.phoneNumber && (
                    <p className="text-xs text-muted-darker truncate">
                      {selectedChat.account.phoneNumber}
                    </p>
                  )}
                </div>
                {selectedChat?.contactId && (
                  <button
                    onClick={() => setContactDrawerOpen(true)}
                    className="text-muted-darker hover:text-foreground transition-colors shrink-0"
                    title="Ver contacto"
                    aria-label="Ver contacto"
                  >
                    <User size={18} />
                  </button>
                )}
              </div>

              {/* Row 2: conversation metadata controls — free to wrap, never fights the name for space */}
              {selectedChat && (
                <div className="flex items-center gap-2 flex-wrap">
                  <ChatTagPicker key={selectedChat.id} chatId={selectedChat.id} />
                  <LeadScoreBadge key={`score-${selectedChat.id}`} chatId={selectedChat.id} />
                  <ChatCostBadge key={`cost-${selectedChat.id}`} chatId={selectedChat.id} />
                  <ChatPublicLinkButton key={`public-link-${selectedChat.id}`} chatId={selectedChat.id} />
                  <ChatAssigneePicker
                    chatId={selectedChat.id}
                    assignedTo={selectedChat.assignedTo}
                    onAssigned={(assignee) =>
                      setChats((prev) => prev.map((c) =>
                        c.id === selectedChatId ? { ...c, assignedTo: assignee, assignedToId: assignee?.id ?? null } : c
                      ))
                    }
                  />
                </div>
              )}
            </div>

            {(messagesError || chatDetailError) && <div className="px-4 pt-3"><Banner tone="warning">
              {chatDetailError || messagesError}
              <Button variant="link" size="sm" onClick={() => { retryMessages(); setDetailRetry((prev) => prev + 1); }}>Reintentar</Button>
            </Banner></div>}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingMessages ? (
                // Burbujas fantasma alternando lado, para que el hilo no salte
                // al llegar los mensajes reales.
                <div className="space-y-3" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={`flex ${i % 3 === 0 ? "justify-end" : "justify-start"}`}>
                      <Skeleton
                        className={`h-12 ${i % 2 === 0 ? "w-52" : "w-64"} ${
                          i % 3 === 0 ? "rounded-bubble-br" : "rounded-2xl rounded-tl-sm"
                        }`}
                      />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <EmptyState icon={MessageSquare} title="Sin mensajes" description="Aún no hay mensajes en este chat." />
                </div>
              ) : (
                <>
                {hasOlderMessages && (
                  <div className="flex justify-center pb-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={loadOlderMessages}
                      disabled={loadingOlder}
                    >
                      {loadingOlder ? <Spinner /> : "Ver mensajes anteriores"}
                    </Button>
                  </div>
                )}
                {messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const showDivider = !prev || chatDayKey(prev.timestamp) !== chatDayKey(msg.timestamp);
                  return (
                    <div key={msg.id}>
                      {showDivider && (
                        <div className="flex justify-center my-3">
                          <span className="text-xs font-medium text-muted-darker bg-surface border border-border px-2.5 py-1 rounded-full">
                            {formatDayDivider(msg.timestamp)}
                          </span>
                        </div>
                      )}
                      <MessageBubble
                        msg={msg}
                        onPreview={setPreviewMedia}
                        isLatest={i === messages.length - 1}
                      />
                    </div>
                  );
                })}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="flex flex-col gap-2 px-4 py-3 border-t border-border bg-surface shrink-0 relative">
              {send?.error && <Banner tone="danger">{send.error} Tu borrador sigue disponible.</Banner>}
              {!serviceWindowOpen && (
                <Banner tone="warning">
                  La ventana de 24 h de WhatsApp está cerrada: Meta no acepta mensajes libres en este chat. Para
                  reabrir la conversación hay que enviar una plantilla aprobada (Campañas).
                </Banner>
              )}
              {cannedSuggestions.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-1.5 rounded-lg border border-border bg-surface shadow-lg overflow-hidden z-20">
                  {cannedSuggestions.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => insertCannedResponse(c.content)}
                      onMouseEnter={() => setCannedIndex(i)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border last:border-b-0 ${
                        i === cannedIndex ? "bg-surface-light" : "hover:bg-surface-light"
                      }`}
                    >
                      <span className="font-mono text-accent">/{c.shortcut}</span>
                      <span className="text-muted-darker ml-2 truncate">{c.content}</span>
                    </button>
                  ))}
                </div>
              )}

              {attachment && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                  {attachmentPreview && isImageMime(attachment.type) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview blob
                    <img src={attachmentPreview} alt={attachment.name} className="h-12 w-12 rounded object-cover animate-fade-in" />
                  ) : isAudioMime(attachment.type) ? (
                    <FileAudio size={18} className="text-muted-darker shrink-0" />
                  ) : isVideoMime(attachment.type) ? (
                    <Video size={18} className="text-muted-darker shrink-0" />
                  ) : (
                    <FileText size={18} className="text-muted-darker shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate">{attachment.name}</p>
                    <p className="text-xs text-muted-darker">{formatBytes(attachment.size)}</p>
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
                  disabled={sending || !serviceWindowOpen}
                  className="text-accent hover:text-accent/80 transition-colors p-2.5 rounded-lg border border-accent/30 bg-accent/10 hover:bg-accent/15 disabled:opacity-50 shrink-0 cursor-pointer"
                  title="Adjuntar medio"
                  aria-label="Adjuntar medio"
                >
                  <Paperclip size={20} />
                </button>
                <Textarea
                  autoGrow
                  rows={1}
                  aria-label="Mensaje"
                  aria-describedby="composer-help"
                  className="flex-1 min-w-0"
                  value={newMessage}
                  onChange={(e) => { setNewMessage(e.target.value); setCannedIndex(0); }}
                  onKeyDown={(e) => {
                    if (cannedSuggestions.length > 0) {
                      const max = cannedSuggestions.length;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setCannedIndex((i) => (i + 1) % max);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setCannedIndex((i) => (i - 1 + max) % max);
                        return;
                      }
                      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                        // Con el dropdown abierto, Enter selecciona la sugerencia
                        // resaltada en lugar de enviar el atajo a medias.
                        e.preventDefault();
                        insertCannedResponse(cannedSuggestions[Math.min(cannedIndex, max - 1)].content);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder={
                    !serviceWindowOpen
                      ? "Ventana de 24 h cerrada — usa una plantilla desde Campañas"
                      : attachment
                        ? "Añadir comentario (opcional)..."
                        : "Escribe un mensaje... (usa /atajo para respuestas rápidas)"
                  }
                  disabled={sending || !drafts.ready || !selectedChat || !serviceWindowOpen}
                />
                <Button
                  type="submit"
                  icon={Send}
                  loading={sending}
                  aria-label="Enviar mensaje"
                  disabled={(!newMessage.trim() && !attachment) || sending || !drafts.ready || !selectedChat || !serviceWindowOpen}
                >
                  <span className="hidden sm:inline">Enviar</span>
                </Button>
              </div>
              <div id="composer-help" className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-darker" aria-live="polite">
                <span>{send?.stage === "uploading" ? "Subiendo adjunto…" : sending ? "Enviando mensaje…" : "Enter para enviar · Mayús + Enter para nueva línea"}</span>
                {(newMessage || attachment) && <span>Borrador de esta conversación</span>}
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

      <MediaPreviewModal media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}
