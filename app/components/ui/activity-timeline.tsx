import Link from "next/link";
import {
  UserPlus,
  StickyNote,
  MessageCircle,
  Clock,
  CheckCircle2,
  Megaphone,
  RotateCcw,
  Ban,
  UserX,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";
import { formatDateTime } from "@/lib/timezone";
import { EmptyState } from "./empty-state";

// Componente "tonto": recibe eventos ya normalizados y ordenados (más
// reciente primero) — no sabe de dónde vienen. El mapeo kind→ícono vive aquí
// adentro (Client/Server-safe, son componentes de Lucide usados directo, no
// pasados como prop) para que cualquier feed de actividad (no solo contactos)
// pueda reusar este primitivo con su propio conjunto de `kind`s.
export interface ActivityTimelineEvent {
  id: string;
  kind: string;
  at: string;
  title: string;
  description?: string;
  href?: string;
}

const KIND_ICON: Record<string, LucideIcon> = {
  contact_created: UserPlus,
  note: StickyNote,
  chat_created: MessageCircle,
  first_response: Clock,
  resolved: CheckCircle2,
  campaign: Megaphone,
  recovery: RotateCcw,
  blocked: Ban,
  opted_out: UserX,
  conversation: MessagesSquare,
};

interface ActivityTimelineProps {
  events: ActivityTimelineEvent[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function ActivityTimeline({
  events,
  emptyTitle = "Sin actividad todavía",
  emptyDescription,
  className,
}: ActivityTimelineProps) {
  if (events.length === 0) {
    return <EmptyState icon={MessagesSquare} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ol className={cn("space-y-0", className)}>
      {events.map((event, i) => {
        const Icon = KIND_ICON[event.kind] ?? MessageCircle;
        const isLast = i === events.length - 1;
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              <span className="shrink-0 font-mono text-[11px] text-muted-darker">
                {formatDateTime(event.at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {event.description && (
              <p className="mt-0.5 text-xs text-muted-darker line-clamp-2 whitespace-pre-wrap">{event.description}</p>
            )}
          </>
        );
        return (
          <li key={event.id} className="relative flex gap-3 pb-5">
            {!isLast && (
              <span className="absolute left-[13px] top-6 bottom-0 w-px bg-border" aria-hidden="true" />
            )}
            <span className="relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-darker">
              <Icon size={13} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              {event.href ? (
                <Link href={event.href} className="block rounded-md -mx-1 px-1 transition-colors hover:bg-surface-light">
                  {content}
                </Link>
              ) : (
                content
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
