import { PageHeader } from "@/app/components/ui/page-header";
import { Skeleton, SkeletonRow } from "@/app/components/ui/skeleton";

export default function EstadisticasLoading() {
  return (
    <div className="space-y-10">
      <PageHeader title="Estadísticas" description="Métricas globales de uso de la plataforma." />

      {/* Franja KPI */}
      <div className="flex flex-wrap gap-x-12 gap-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>

      {/* Barra de pestañas (Resumen / IA y costos / Campañas / Equipo y leads) */}
      <div className="flex gap-4 border-b border-border pb-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-24" />
        ))}
      </div>

      {/* Aproxima la pestaña "Resumen" (la que se ve por default al cargar):
          1 sección principal (mensajes diarios) + 1 sección en el aside
          (chats por número) — el resto de pestañas (IA, Campañas, Equipo)
          solo se montan tras elegirlas, no necesitan esqueleto propio. */}
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-10">
          <div className="space-y-3">
            <Skeleton className="h-6 w-44" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 flex-1 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-10">
          <div className="space-y-3">
            <Skeleton className="h-6 w-36" />
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} cols={2} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
