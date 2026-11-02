import { unstable_cache } from "next/cache";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";
import { organizationIdWhere } from "@/lib/admin/org-context-utils";
import type { AdminOrgOption } from "@/lib/admin/org-context-types";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";

const orgSelect = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
} as const;

async function fetchAllOrganizations(): Promise<AdminOrgOption[]> {
  return prisma.organization.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: orgSelect,
  });
}

async function fetchMembershipOrganizations(userId: string): Promise<AdminOrgOption[]> {
  const members = await prisma.organizationMember.findMany({
    where: { userId, isActive: true },
    include: { organization: { select: orgSelect } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => m.organization);
}

const cachedAllOrganizations = unstable_cache(
  fetchAllOrganizations,
  ["admin-orgs-all"],
  { revalidate: CACHE_TTL.orgs, tags: [CACHE_TAGS.orgs] }
);

const cachedMembershipOrganizations = unstable_cache(
  fetchMembershipOrganizations,
  ["admin-orgs-membership"],
  { revalidate: CACHE_TTL.orgs, tags: [CACHE_TAGS.orgs] }
);

export async function getCachedAllOrganizations() {
  return cachedAllOrganizations();
}

export async function getCachedMembershipOrganizations(userId: string) {
  return cachedMembershipOrganizations(userId);
}

export type DashboardBundle = {
  stats: Awaited<ReturnType<typeof EventService.getOrgDashboardStats>>;
  events: {
    id: string;
    name: string;
    status: string;
    startsAt: string;
    organization: { id: string; name: string };
  }[];
  salesPerDay: { date: string; amount: number }[];
};

async function fetchDashboardBundle(organizationId: string | null): Promise<DashboardBundle> {
  const orgFilter = organizationIdWhere(organizationId);
  const [stats, events, paidOrders] = await Promise.all([
    EventService.getOrgDashboardStats(organizationId),
    prisma.event.findMany({
      where: orgFilter,
      select: {
        id: true,
        name: true,
        status: true,
        startsAt: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 10,
    }),
    prisma.order.findMany({
      where: {
        ...orgFilter,
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        ],
      },
      select: { total: true, paidAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const byDayMap = new Map<string, number>();
  for (const o of paidOrders) {
    const d = (o.paidAt ?? o.createdAt).toISOString().slice(0, 10);
    byDayMap.set(d, (byDayMap.get(d) ?? 0) + o.total);
  }

  return {
    stats,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      startsAt: e.startsAt.toISOString(),
      organization: e.organization,
    })),
    salesPerDay: [...byDayMap.entries()].map(([date, amount]) => ({ date, amount })),
  };
}

/** Request-deduped + short TTL cross-request cache for dashboard KPIs. */
export const getCachedDashboardBundle = cache(async (organizationId: string | null) => {
  return unstable_cache(
    () => fetchDashboardBundle(organizationId),
    ["admin-dashboard-bundle", organizationId ?? "global"],
    {
      revalidate: CACHE_TTL.dashboard,
      tags: [CACHE_TAGS.dashboard, CACHE_TAGS.dashboardOrg(organizationId)],
    }
  )();
});

export type AdminEventListRow = {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  capacity: number;
  startsAt: string;
  timezone: string;
  organization: { id: string; name: string };
  sold: number;
};

async function fetchAdminEventList(organizationId: string | null): Promise<AdminEventListRow[]> {
  const events = await prisma.event.findMany({
    where: organizationIdWhere(organizationId),
    select: {
      id: true,
      organizationId: true,
      name: true,
      status: true,
      capacity: true,
      startsAt: true,
      timezone: true,
      organization: { select: { id: true, name: true } },
      ticketTypes: { select: { quantitySold: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  return events.map((e) => ({
    id: e.id,
    organizationId: e.organizationId,
    name: e.name,
    status: e.status,
    capacity: e.capacity,
    startsAt: e.startsAt.toISOString(),
    timezone: e.timezone,
    organization: e.organization,
    sold: e.ticketTypes.reduce((s, t) => s + t.quantitySold, 0),
  }));
}

/** Admin events list metadata — sold counts may lag up to TTL; not used for checkout. */
export const getCachedAdminEventList = cache(async (organizationId: string | null) => {
  return unstable_cache(
    () => fetchAdminEventList(organizationId),
    ["admin-event-list", organizationId ?? "global"],
    {
      revalidate: CACHE_TTL.adminEvents,
      tags: [CACHE_TAGS.adminEvents, CACHE_TAGS.adminEventsOrg(organizationId)],
    }
  )();
});

/** Public browse lists only — never use for checkout/reserve/scanner. */
export const getCachedPublicEventList = cache(async (take?: number, city?: string) => {
  const t = take ?? 50;
  return unstable_cache(
    () => EventService.listPublic({ take: t, city }),
    ["public-event-list", String(t), city ?? ""],
    {
      revalidate: CACHE_TTL.publicEvents,
      tags: [CACHE_TAGS.publicEvents],
    }
  )();
});
