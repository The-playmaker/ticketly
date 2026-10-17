import type { Event, Organization, TicketType, Venue } from "@prisma/client";

export type PublishBlocker = {
  code: string;
  field: string;
  message: string;
};

type OrgLike = Pick<
  Organization,
  | "id"
  | "legalName"
  | "organizationNumber"
  | "customerServiceEmail"
  | "contactEmail"
  | "refundPolicyText"
  | "refundPolicyType"
  | "termsVersion"
  | "isActive"
>;

type EventLike = Pick<
  Event,
  | "name"
  | "startsAt"
  | "endsAt"
  | "venueId"
  | "address"
  | "city"
  | "ageLimit"
  | "capacity"
  | "sellerOrganizationId"
  | "organizationId"
  | "termsVersion"
  | "refundPolicyText"
  | "refundPolicyType"
>;

type TicketTypeLike = Pick<TicketType, "name" | "price" | "quantityTotal" | "isVisible">;

/**
 * Pre-LIVE publish gate. Optional fields (lineup, cover image, etc.) are not required.
 */
export function getEventPublishBlockers(input: {
  event: EventLike;
  organizer: OrgLike;
  seller: OrgLike | null;
  ticketTypes: TicketTypeLike[];
  venue: Pick<Venue, "id" | "name"> | null;
  paymentConfigured: boolean;
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  const seller = input.seller ?? input.organizer;

  if (!seller || !seller.isActive) {
    blockers.push({
      code: "SELLER_MISSING",
      field: "sellerOrganization",
      message: "Selgerorganisasjon mangler eller er deaktivert",
    });
  } else {
    if (!seller.legalName?.trim()) {
      blockers.push({
        code: "LEGAL_NAME",
        field: "legalName",
        message: "Juridisk navn på selger mangler",
      });
    }
    if (!seller.organizationNumber?.trim()) {
      blockers.push({
        code: "ORG_NUMBER",
        field: "organizationNumber",
        message: "Organisasjonsnummer mangler",
      });
    }
    const supportEmail = seller.customerServiceEmail?.trim() || seller.contactEmail?.trim();
    if (!supportEmail) {
      blockers.push({
        code: "SUPPORT_EMAIL",
        field: "customerServiceEmail",
        message: "Kundeservice-e-post mangler",
      });
    }
    const refundOk =
      !!seller.refundPolicyText?.trim() ||
      !!input.event.refundPolicyText?.trim() ||
      seller.refundPolicyType === "NO_REFUND";
    if (!refundOk) {
      blockers.push({
        code: "REFUND_POLICY",
        field: "refundPolicyText",
        message: "Refusjonspolicy mangler",
      });
    }
    const terms =
      input.event.termsVersion?.trim() || seller.termsVersion?.trim();
    if (!terms) {
      blockers.push({
        code: "TERMS_VERSION",
        field: "termsVersion",
        message: "Vilkårsversjon mangler",
      });
    }
  }

  if (!input.event.startsAt || !input.event.endsAt) {
    blockers.push({
      code: "EVENT_DATES",
      field: "startsAt",
      message: "Start- og sluttid mangler",
    });
  }

  const hasVenue =
    !!input.venue ||
    !!(input.event.address?.trim() && input.event.city?.trim()) ||
    !!input.event.venueId;
  if (!hasVenue) {
    blockers.push({
      code: "VENUE",
      field: "venue",
      message: "Venue eller adresse/by mangler",
    });
  }

  const visibleTypes = input.ticketTypes.filter((t) => t.isVisible !== false);
  if (!visibleTypes.length) {
    blockers.push({
      code: "TICKET_TYPE",
      field: "ticketTypes",
      message: "Minst én billetstype kreves",
    });
  } else {
    for (const tt of visibleTypes) {
      if (tt.price == null || tt.price < 0) {
        blockers.push({
          code: "TICKET_PRICE",
          field: `ticketTypes.${tt.name}.price`,
          message: `Pris mangler for «${tt.name}»`,
        });
      }
      if (!tt.quantityTotal || tt.quantityTotal < 1) {
        blockers.push({
          code: "TICKET_CAPACITY",
          field: `ticketTypes.${tt.name}.quantityTotal`,
          message: `Kapasitet mangler for «${tt.name}»`,
        });
      }
    }
  }

  // Age is required only when explicitly set to invalid; null = no age limit (OK).
  // If ageLimit is set it must be a positive integer.
  if (input.event.ageLimit != null && input.event.ageLimit < 0) {
    blockers.push({
      code: "AGE_LIMIT",
      field: "ageLimit",
      message: "Ugyldig aldersgrense",
    });
  }

  if (!input.paymentConfigured) {
    blockers.push({
      code: "PAYMENT_PROVIDER",
      field: "payment",
      message: "Betalingsleverandør er ikke konfigurert",
    });
  }

  return blockers;
}

export function formatPublishBlockedMessage(blockers: PublishBlocker[]): string {
  if (!blockers.length) return "";
  const list = blockers.map((b) => `• ${b.message}`).join("\n");
  return `Kan ikke publiseres:\n${list}`;
}
