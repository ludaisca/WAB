import { ActivityTimeline } from "@/app/components/ui/activity-timeline";
import { SkeletonRow } from "@/app/components/ui/skeleton";
import type { ActivityEvent } from "@/app/api/whatsapp/contacts/[id]/activity/route";

// Contenido de la pestaña "Actividad" — deliberadamente solo presentacional
// (recibe `events` ya resueltos por ContactRecord, que hace el único fetch a
// /activity y lo comparte con la pestaña "Resumen" para qualifiedData/scores).
// Un fetch propio aquí adentro duplicaría esa misma llamada sin necesidad,
// ya que ambas pestañas leen del mismo payload.
export function ContactTimeline({ events, loading }: { events: ActivityEvent[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={2} />)}
      </div>
    );
  }

  return (
    <ActivityTimeline
      events={events}
      emptyTitle="Sin actividad todavía"
      emptyDescription="Notas, respuestas y otros eventos de este contacto aparecerán aquí."
    />
  );
}
