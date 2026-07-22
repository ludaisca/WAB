import { PageHeader } from "@/app/components/ui/page-header";
import { Skeleton, SkeletonRow } from "@/app/components/ui/skeleton";

export default function AuditoriaLoading() {
  return (
    <div className="space-y-8">
      <PageHeader title="Auditoría del Asistente IA" description="Historial de todas las acciones MINOR y CONFIRM ejecutadas, rechazadas o pendientes." />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} cols={5} />
        ))}
      </div>
    </div>
  );
}
