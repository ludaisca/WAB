import { PageHeader } from "@/app/components/ui/page-header";
import { Skeleton, SkeletonRow } from "@/app/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-10">
      <PageHeader title="Panel" description="Resumen de tu actividad en WhatsApp" />

      {/* Franja KPI */}
      <div className="flex flex-wrap gap-x-12 gap-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} cols={3} />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3.5">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
