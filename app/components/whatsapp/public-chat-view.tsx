"use client";

// Vista de solo lectura para /c/[token] — deliberadamente independiente del
// MessageBubble/MediaContent de chat-workspace.tsx: acá no hay composer, no
// hay acciones (asignar, etiquetar, calificar, responder), no hay links hacia
// rutas protegidas, y los adjuntos se piden a la ruta pública de media
// (/api/public/chat/[token]/media/[id]), no a la autenticada.
import { useState } from "react";
import { Eye, FileAudio, Video, FileText, Image as ImageIcon, Download, Maximize2, Check, CheckCheck } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { formatBubbleTime, formatDayDivider, chatDayKey } from "@/lib/whatsapp/chat-format";
import type { PublicChatData, PublicChatMessage } from "@/lib/whatsapp/public-chat-data";

function mediaEndpoint(token: string, messageId: string): string {
  return `/api/public/chat/${encodeURIComponent(token)}/media/${encodeURIComponent(messageId)}`;
}

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
}

function MediaContent({
  token,
  msg,
  onPreview,
}: {
  token: string;
  msg: PublicChatMessage;
  onPreview: (media: PreviewMedia) => void;
}) {
  const mediaSrc = msg.hasMedia ? mediaEndpoint(token, msg.id) : null;

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
      <button type="button" onClick={() => onPreview({ type: "image", src: mediaSrc, filename: msg.filename })} className="block cursor-zoom-in">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied media, runtime URL */}
        <img src={mediaSrc} alt={msg.caption ?? "imagen"} className="max-w-full max-h-72 rounded-lg object-cover" loading="lazy" />
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
        <audio controls src={mediaSrc} className="w-full max-w-xs" />
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
          onClick={() => onPreview({ type: "video", src: mediaSrc, filename: msg.filename })}
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
      <a href={mediaSrc} download={msg.filename ?? undefined} className="flex items-center gap-2 text-xs hover:underline">
        <FileText size={14} />
        <span className="truncate">{msg.filename ?? "Documento"}</span>
        {msg.bytesSize ? <span className="text-muted-darker">({formatBytes(msg.bytesSize)})</span> : null}
      </a>
    );
  }

  return null;
}

// Tipos que MediaContent sabe renderizar — cualquier otro messageType (ej.
// "button"/"interactive", respuestas de botones de WhatsApp sin media ni
// caption) debe caer al texto plano de msg.body, igual que chat-workspace.tsx
// ya hace vía su propio `hasMedia` (mediaUrl || mediaId). Antes este
// componente usaba `messageType !== "text"` como gate único — un mensaje tipo
// "button" entraba a la rama de media, MediaContent devolvía null (tipo no
// reconocido) y, al no tener caption tampoco, la burbuja quedaba vacía salvo
// por la hora.
const MEDIA_MESSAGE_TYPES = new Set(["image", "sticker", "audio", "video", "document"]);

function MessageBubble({ token, msg, onPreview }: { token: string; msg: PublicChatMessage; onPreview: (media: PreviewMedia) => void }) {
  const isInbound = msg.direction === "INBOUND";
  const isMediaType = MEDIA_MESSAGE_TYPES.has(msg.messageType);
  const caption = msg.caption ?? (isMediaType && msg.body && msg.body !== `[${msg.messageType}]` ? msg.body : null);

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div className="relative max-w-[75%]">
        <div
          className={`px-3.5 py-2.5 text-sm leading-relaxed ${
            isInbound ? "rounded-2xl rounded-tl-sm bg-surface text-foreground" : "rounded-bubble-br bg-accent text-on-accent"
          }`}
        >
          {isMediaType && (
            <div className="mb-1 space-y-1">
              <MediaContent token={token} msg={msg} onPreview={onPreview} />
              {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
            </div>
          )}
          {!isMediaType && msg.body}
          {isMediaType && !caption && !msg.body && <span className="sr-only">[{msg.messageType}]</span>}
          <div className={`flex items-center justify-end gap-1 mt-1 ${isInbound ? "text-muted-darker" : "text-on-accent/70"}`}>
            <span className="text-[10px]">{formatBubbleTime(msg.timestamp)}</span>
            {!isInbound && msg.status && (
              <span className="text-[10px]">
                {msg.status === "sent" && <Check size={10} />}
                {msg.status === "delivered" && <CheckCheck size={10} />}
                {msg.status === "read" && <CheckCheck size={10} className="text-info" />}
              </span>
            )}
          </div>
        </div>
        {msg.reaction && (
          <span
            className={`absolute -bottom-2 ${isInbound ? "right-0" : "left-0"} flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-light px-1 text-xs shadow-sm ring-1 ring-border`}
            title="Reacción del contacto"
          >
            {msg.reaction}
          </span>
        )}
      </div>
    </div>
  );
}

export function PublicChatView({ token, data }: { token: string; data: PublicChatData }) {
  const [preview, setPreview] = useState<PreviewMedia | null>(null);

  let lastDay: string | null = null;

  return (
    <div className="max-w-2xl mx-auto min-h-dvh flex flex-col">
      <header className="border-b border-border px-5 py-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-darker">
          <Eye size={13} />
          <span>Vista de solo lectura — no requiere iniciar sesión</span>
        </div>
        <h1 className="text-lg font-semibold text-foreground">{data.name}</h1>
        <p className="text-xs text-muted-darker">
          {data.phone ? `${data.phone} · ` : ""}
          {data.accountName}
        </p>
      </header>

      <div className="flex-1 px-4 py-4 space-y-3">
        {data.messages.length === 0 ? (
          <p className="text-center text-sm text-muted-darker py-16">Esta conversación aún no tiene mensajes.</p>
        ) : (
          data.messages.map((msg) => {
            const day = chatDayKey(msg.timestamp);
            const showDivider = day !== lastDay;
            lastDay = day;
            return (
              <div key={msg.id}>
                {showDivider && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-medium text-muted-darker bg-surface px-2.5 py-1 rounded-full">
                      {formatDayDivider(msg.timestamp)}
                    </span>
                  </div>
                )}
                <MessageBubble token={token} msg={msg} onPreview={setPreview} />
              </div>
            );
          })
        )}
      </div>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        size="lg"
        title={preview?.filename ?? (preview?.type === "image" ? "Imagen" : "Video")}
        footer={
          preview && (
            <Button href={preview.src} external icon={Download} variant="secondary" {...{ download: preview.filename ?? "" }}>
              Descargar
            </Button>
          )
        }
      >
        {preview?.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied media, runtime URL
          <img src={preview.src} alt={preview.filename ?? "imagen"} className="max-h-[70vh] w-auto mx-auto rounded-lg" />
        ) : preview ? (
          <video src={preview.src} controls autoPlay className="max-h-[70vh] w-full rounded-lg" />
        ) : null}
      </Modal>
    </div>
  );
}
