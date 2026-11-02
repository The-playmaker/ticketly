import { revalidateTag } from "next/cache";

/** Short-lived Next.js data-cache tags (no Redis). */
export const CACHE_TAGS = {
  orgs: "admin:orgs",
  dashboard: "admin:dashboard",
  dashboardOrg: (organizationId: string | null) =>
    `admin:dashboard:${organizationId ?? "global"}`,
  adminEvents: "admin:events",
  adminEventsOrg: (organizationId: string | null) =>
    `admin:events:${organizationId ?? "global"}`,
  publicEvents: "public:events",
} as const;

export const CACHE_TTL = {
  /** Org switcher / membership lists — rarely change */
  orgs: 60,
  /** KPI aggregates — OK to lag a few seconds */
  dashboard: 20,
  /** Admin event list metadata (sold counts may lag briefly) */
  adminEvents: 30,
  /** Public browse lists — checkout/reserve stay live */
  publicEvents: 30,
} as const;

/** Immediate expire profile for Route Handler mutations (Next 16+). */
const IMMEDIATE = { expire: 0 } as const;

function bust(tag: string) {
  revalidateTag(tag, IMMEDIATE);
}

/** Bust admin + public caches after event/org mutations. */
export function revalidateAdminDataCaches(organizationId?: string | null) {
  bust(CACHE_TAGS.orgs);
  bust(CACHE_TAGS.dashboard);
  bust(CACHE_TAGS.adminEvents);
  bust(CACHE_TAGS.publicEvents);
  if (organizationId !== undefined) {
    bust(CACHE_TAGS.dashboardOrg(organizationId));
    bust(CACHE_TAGS.adminEventsOrg(organizationId));
    // Global SUPER_ADMIN aggregates also include this org
    bust(CACHE_TAGS.dashboardOrg(null));
    bust(CACHE_TAGS.adminEventsOrg(null));
  }
}
