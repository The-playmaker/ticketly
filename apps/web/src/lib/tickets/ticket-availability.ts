/**
 * Centralized customer-facing ticket availability / sales status.
 * Must stay aligned with ReservationService.reserve eligibility checks.
 */

import { formatEventDate, formatEventTime } from "@/lib/time";

export type TicketAvailabilityKind =
  | "available"
  | "sales_ended"
  | "sold_out"
  | "sales_not_open"
  | "temporarily_unavailable"
  | "more_coming"
  | "technical_error";

export type TicketAvailabilityTone = "neutral" | "info" | "error";

export type TicketAvailabilityPresentation = {
  kind: TicketAvailabilityKind;
  /** When true, UI may offer purchase / quantity controls. */
  purchasable: boolean;
  heading: string;
  description: string;
  tone: TicketAvailabilityTone;
  /** ISO timestamp when sales open (sales_not_open only). */
  opensAt?: string | null;
};

export type EventSalesContext = {
  status?: string | null;
  salesStartAt?: Date | string | null;
  salesEndAt?: Date | string | null;
  salesPausedAt?: Date | string | null;
  soldOutDisplay?: "SOLD_OUT" | "MORE_COMING" | "PAUSED" | string | null;
  timezone?: string | null;
};

export type TicketTypeSalesContext = {
  available: number;
  salesStartAt?: Date | string | null;
  salesEndAt?: Date | string | null;
  salesPausedAt?: Date | string | null;
  isPubliclyPurchasable?: boolean | null;
  isVisible?: boolean | null;
};

const COPY = {
  sales_ended: {
    heading: "Billettsalget er avsluttet",
    description: "Salget av denne billettypen er ikke lenger tilgjengelig.",
  },
  sold_out: {
    heading: "Utsolgt",
    description: "Denne billettypen er dessverre utsolgt.",
  },
  more_coming: {
    heading: "Flere billetter kommer",
    description: "Denne billettypen er midlertidig utsolgt. Flere billetter kan bli tilgjengelige.",
  },
  sales_not_open: {
    heading: "Billettsalget åpner snart",
    descriptionFallback: "Salget er ikke åpnet ennå.",
  },
  temporarily_unavailable: {
    heading: "Billettsalget er midlertidig utilgjengelig",
    description: "Vi kan for øyeblikket ikke tilby billettkjøp. Prøv igjen senere.",
  },
  technical_error: {
    heading: "Noe gikk galt",
    description: "Vi kunne ikke fullføre forespørselen. Prøv igjen.",
  },
} as const;

/** API / AppError codes that are business states, not technical failures. */
export const BUSINESS_AVAILABILITY_ERROR_CODES = new Set([
  "SALES_ENDED",
  "SALES_NOT_STARTED",
  "SALES_PAUSED",
  "TICKET_SOLD_OUT",
  "EVENT_NOT_ON_SALE",
  "EVENT_CANCELLED",
  "FREE_TICKET_NOT_PUBLIC",
]);

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ISO string (or null) for Client Component props.
 * Passing Prisma `Date` across the RSC → client boundary throws in production
 * as React minified error #441 ("An error occurred in the Server Components render…").
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

/** Strip Date instances from event sales context for TicketSelector / client props. */
export function serializeEventSalesContext(event: EventSalesContext): EventSalesContext {
  return {
    ...event,
    salesStartAt: toIsoDate(event.salesStartAt),
    salesEndAt: toIsoDate(event.salesEndAt),
    salesPausedAt: toIsoDate(event.salesPausedAt),
  };
}

/** Strip Date instances from ticket-type sales context for client props. */
export function serializeTicketTypeSalesContext(
  ticketType: TicketTypeSalesContext
): TicketTypeSalesContext {
  return {
    ...ticketType,
    salesStartAt: toIsoDate(ticketType.salesStartAt),
    salesEndAt: toIsoDate(ticketType.salesEndAt),
    salesPausedAt: toIsoDate(ticketType.salesPausedAt),
  };
}

function formatOpensDescription(opensAt: Date, timezone: string): string {
  const date = formatEventDate(opensAt, timezone, "d. MMMM yyyy");
  const time = formatEventTime(opensAt, timezone);
  return `Salget åpner ${date} kl. ${time}.`;
}

function presentation(
  kind: Exclude<TicketAvailabilityKind, "available">,
  overrides?: Partial<Pick<TicketAvailabilityPresentation, "description" | "opensAt" | "heading">>
): TicketAvailabilityPresentation {
  if (kind === "sales_not_open") {
    return {
      kind,
      purchasable: false,
      heading: COPY.sales_not_open.heading,
      description: overrides?.description ?? COPY.sales_not_open.descriptionFallback,
      tone: "neutral",
      opensAt: overrides?.opensAt ?? null,
    };
  }
  if (kind === "technical_error") {
    return {
      kind,
      purchasable: false,
      heading: overrides?.heading ?? COPY.technical_error.heading,
      description: overrides?.description ?? COPY.technical_error.description,
      tone: "error",
    };
  }
  const base = COPY[kind];
  return {
    kind,
    purchasable: false,
    heading: overrides?.heading ?? base.heading,
    description: overrides?.description ?? base.description,
    tone: "neutral",
    opensAt: overrides?.opensAt,
  };
}

/**
 * Resolve purchase eligibility + customer copy for one ticket type in an event context.
 * Priority mirrors ReservationService.reserve (event gates → type gates → inventory).
 */
export function resolveTicketAvailability(
  event: EventSalesContext,
  ticketType: TicketTypeSalesContext,
  now: Date = new Date()
): TicketAvailabilityPresentation {
  const tz = event.timezone || "Europe/Oslo";
  const eventStatus = event.status ?? "PUBLISHED";

  if (eventStatus === "CANCELLED") {
    return presentation("temporarily_unavailable", {
      heading: "Arrangementet er kansellert",
      description: "Billettsalget er ikke tilgjengelig for dette arrangementet.",
    });
  }

  if (eventStatus === "COMPLETED") {
    return presentation("sales_ended");
  }

  if (
    eventStatus === "DRAFT" ||
    eventStatus === "SCHEDULED" ||
    eventStatus === "ARCHIVED"
  ) {
    const start = toDate(event.salesStartAt);
    if (start && start > now) {
      return presentation("sales_not_open", {
        description: formatOpensDescription(start, tz),
        opensAt: start.toISOString(),
      });
    }
    return presentation("sales_not_open");
  }

  if (event.salesPausedAt || eventStatus === "PAUSED") {
    return presentation("temporarily_unavailable");
  }

  const eventSalesStart = toDate(event.salesStartAt);
  if (eventSalesStart && eventSalesStart > now) {
    return presentation("sales_not_open", {
      description: formatOpensDescription(eventSalesStart, tz),
      opensAt: eventSalesStart.toISOString(),
    });
  }

  const eventSalesEnd = toDate(event.salesEndAt);
  if (eventSalesEnd && eventSalesEnd < now) {
    return presentation("sales_ended");
  }

  if (ticketType.isPubliclyPurchasable === false) {
    return presentation("temporarily_unavailable", {
      description: "Denne billettypen kan ikke kjøpes her.",
    });
  }

  if (ticketType.salesPausedAt) {
    return presentation("temporarily_unavailable");
  }

  const typeSalesStart = toDate(ticketType.salesStartAt);
  if (typeSalesStart && typeSalesStart > now) {
    return presentation("sales_not_open", {
      description: formatOpensDescription(typeSalesStart, tz),
      opensAt: typeSalesStart.toISOString(),
    });
  }

  const typeSalesEnd = toDate(ticketType.salesEndAt);
  if (typeSalesEnd && typeSalesEnd < now) {
    return presentation("sales_ended");
  }

  if (ticketType.available <= 0 || eventStatus === "SOLD_OUT") {
    const mode = event.soldOutDisplay ?? "SOLD_OUT";
    if (mode === "MORE_COMING") return presentation("more_coming");
    if (mode === "PAUSED") return presentation("temporarily_unavailable");
    return presentation("sold_out");
  }

  return {
    kind: "available",
    purchasable: true,
    heading: "",
    description: "",
    tone: "neutral",
  };
}

/**
 * Aggregate status when showing event-level messaging (e.g. all types blocked).
 * Prefers the most specific shared blocker; falls back to sold_out when inventory is the cause.
 */
export function resolveEventAvailability(
  event: EventSalesContext,
  ticketTypes: TicketTypeSalesContext[],
  now: Date = new Date()
): TicketAvailabilityPresentation {
  if (ticketTypes.length === 0) {
    return presentation("temporarily_unavailable", {
      description: "Det er ingen billettyper tilgjengelig for dette arrangementet.",
    });
  }

  const statuses = ticketTypes.map((tt) => resolveTicketAvailability(event, tt, now));
  const purchasable = statuses.filter((s) => s.purchasable);
  if (purchasable.length > 0) {
    return {
      kind: "available",
      purchasable: true,
      heading: "",
      description: "",
      tone: "neutral",
    };
  }

  const kindOrder: TicketAvailabilityKind[] = [
    "temporarily_unavailable",
    "sales_not_open",
    "sales_ended",
    "more_coming",
    "sold_out",
    "technical_error",
  ];

  for (const kind of kindOrder) {
    const match = statuses.find((s) => s.kind === kind);
    if (match) return match;
  }

  return presentation("sold_out");
}

/** Map reserve/checkout API error codes to the shared presentation. */
export function availabilityFromErrorCode(
  code: string | null | undefined,
  options?: { opensAt?: Date | string | null; timezone?: string | null; message?: string | null }
): TicketAvailabilityPresentation | null {
  if (!code) return null;
  const tz = options?.timezone || "Europe/Oslo";

  switch (code) {
    case "SALES_ENDED":
      return presentation("sales_ended");
    case "SALES_NOT_STARTED": {
      const opens = toDate(options?.opensAt ?? null);
      if (opens) {
        return presentation("sales_not_open", {
          description: formatOpensDescription(opens, tz),
          opensAt: opens.toISOString(),
        });
      }
      return presentation("sales_not_open");
    }
    case "SALES_PAUSED":
    case "EVENT_NOT_ON_SALE":
    case "EVENT_CANCELLED":
    case "FREE_TICKET_NOT_PUBLIC":
      return presentation("temporarily_unavailable");
    case "TICKET_SOLD_OUT":
      return presentation("sold_out");
    default:
      if (BUSINESS_AVAILABILITY_ERROR_CODES.has(code)) {
        return presentation("temporarily_unavailable");
      }
      return null;
  }
}

export function technicalErrorPresentation(
  description?: string | null
): TicketAvailabilityPresentation {
  return presentation("technical_error", {
    description: description?.trim() || COPY.technical_error.description,
  });
}

/** Low-stock / exact remaining label when the type is purchasable. */
export function inventoryHint(
  available: number,
  options?: {
    availabilityDisplay?: "SHOW_EXACT" | "SHOW_LOW_STOCK_ONLY" | "HIDE" | string | null;
    lowStockThreshold?: number | null;
  }
): string | null {
  const mode = options?.availabilityDisplay ?? "SHOW_LOW_STOCK_ONLY";
  if (mode === "HIDE") return null;
  if (mode === "SHOW_EXACT") return `${available} igjen`;
  const threshold = options?.lowStockThreshold ?? 10;
  if (available <= threshold) {
    return available <= 5 ? "Få igjen" : `${available} igjen`;
  }
  return null;
}
