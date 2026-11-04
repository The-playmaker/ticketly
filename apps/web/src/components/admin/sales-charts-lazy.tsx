"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * recharts is heavy (~100 kB gz). Load it in a separate chunk after the
 * dashboard KPIs have painted instead of blocking the admin landing page.
 */
export const SalesChartsLazy = dynamic(
  () => import("@/components/admin/sales-charts").then((m) => m.SalesCharts),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4">
        <h2 className="mb-4 font-display text-lg font-semibold">Billettsalg over tid</h2>
        <Skeleton className="h-64 w-full" />
      </div>
    ),
  }
);
