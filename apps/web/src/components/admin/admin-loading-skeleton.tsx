import { Skeleton } from "@/components/ui/skeleton";

export function AdminPageSkeleton({
  kpiCount = 4,
  rows = 6,
}: {
  kpiCount?: number;
  rows?: number;
}) {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Laster">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] p-4"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

export function AdminKpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] p-4"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

export function AdminTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Laster">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function LiveOpsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Laster live data">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
      <AdminKpiSkeleton count={8} />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
