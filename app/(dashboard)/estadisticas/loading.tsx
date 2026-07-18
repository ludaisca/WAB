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

      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-10">
          {/* Mensajes diarios */}
          <div className="space-y-3">
            <Skeleton className="h-6 w-44" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 flex-1 rounded-full" />
              </div>
            ))}
          </div>

          {/* Tablas */}
          {Array.from({ length: 2 }).map((_, t) => (
            <div key={t} className="space-y-3">
              <Skeleton className="h-6 w-52" />
              <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonRow key={i} cols={4} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-10">
          {Array.from({ length: 3 }).map((_, s) => (
            <div key={s} className="space-y-3">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
