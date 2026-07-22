import { PageHeader } from "@/app/components/ui/page-header";
import { Skeleton } from "@/app/components/ui/skeleton";

export default function AsistenteIaLoading() {
  return (
    <div className="space-y-10">
      <PageHeader title="Asistente IA" description="Consulta y administra el sistema en lenguaje natural." />
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 lg:order-1">
          <Skeleton className="h-[70vh] w-full rounded-xl" />
        </div>
        <div className="space-y-3 lg:order-2">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
