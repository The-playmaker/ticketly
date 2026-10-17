import type { CheckoutDisclosure, SellerOfRecordInfo, RefundPolicyType } from "@ticketly/shared-types";
import { prisma } from "@ticketly/database";

/**
 * Compliance helpers — seller of record, terms snapshots, GDPR consent.
 *
 * LEGAL DISCLAIMER: This software is not legal advice. Terms and tax treatment
 * must be approved by the business / counsel before production use in Norway/EEA.
 */

export async function getSellerOfRecord(organizationId: string): Promise<SellerOfRecordInfo> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return {
    legalName: org.legalName ?? org.name,
    organizationNumber: org.organizationNumber,
    address: org.legalAddress,
    postalCode: org.legalPostalCode,
    city: org.legalCity,
    country: org.legalCountry,
    customerServiceEmail: org.customerServiceEmail ?? org.contactEmail,
    customerServicePhone: org.customerServicePhone,
    vatRegistrationStatus: org.vatRegistrationStatus,
    termsVersion: org.termsVersion,
  };
}

export async function buildCheckoutDisclosure(input: {
  eventId: string;
  lines: {
    ticketTypeName: string;
    quantity: number;
    unitPriceOre: number;
    serviceFeeOre: number;
    lineTotalOre: number;
  }[];
  subtotalOre: number;
  serviceFeeOre: number;
  discountOre: number;
  taxOre: number;
  totalOre: number;
}): Promise<CheckoutDisclosure> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: input.eventId },
    include: { venue: true, sellerOrganization: true },
  });
  const seller = await getSellerOfRecord(event.sellerOrganizationId);
  const refundType =
    (event.refundPolicyType as RefundPolicyType | null) ??
    (event.sellerOrganization.refundPolicyType as RefundPolicyType);

  return {
    eventName: event.name,
    eventStartsAt: event.startsAt.toISOString(),
    venue: event.venue?.name ?? event.city ?? "",
    lines: input.lines,
    subtotalOre: input.subtotalOre,
    serviceFeeOre: input.serviceFeeOre,
    discountOre: input.discountOre,
    taxOre: input.taxOre,
    totalOre: input.totalOre,
    currency: event.currency,
    seller,
    refundPolicyType: refundType,
    refundPolicyText: event.refundPolicyText ?? event.sellerOrganization.refundPolicyText,
    termsVersion: event.termsVersion ?? event.sellerOrganization.termsVersion,
  };
}

/** Immutable receipt snapshot at payment confirmation time */
export async function createOrderSnapshot(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: true,
      event: { include: { venue: true, sellerOrganization: true } },
      organization: true,
    },
  });

  const sellerOrg = order.event.sellerOrganization;
  const seller = await getSellerOfRecord(order.event.sellerOrganizationId);

  const existing = await prisma.orderSnapshot.findUnique({ where: { orderId } });
  if (existing) return existing;

  return prisma.orderSnapshot.create({
    data: {
      orderId,
      sellerLegalName: seller.legalName,
      sellerOrgNumber: seller.organizationNumber,
      sellerAddress: [seller.address, seller.postalCode, seller.city].filter(Boolean).join(", "),
      termsVersion: order.termsVersion ?? seller.termsVersion,
      refundPolicyType: order.refundPolicyType ?? sellerOrg.refundPolicyType,
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
      currency: order.currency,
      payload: {
        seller,
        order: {
          orderNumber: order.orderNumber,
          subtotal: order.subtotal,
          serviceFee: order.serviceFee,
          tax: order.tax,
          discount: order.discount,
          total: order.total,
          organizerAmount: order.organizerAmount,
          platformFeeAmount: order.platformFeeAmount,
          paymentProcessingFee: order.paymentProcessingFee,
          currency: order.currency,
          termsVersion: order.termsVersion,
          termsAcceptedAt: order.termsAcceptedAt,
          privacyVersion: order.privacyVersion,
          refundPolicyVersion: order.refundPolicyVersion,
          refundPolicyType: order.refundPolicyType,
          marketingOptIn: order.marketingOptIn,
        },
        items: order.items,
        event: {
          id: order.event.id,
          name: order.event.name,
          startsAt: order.event.startsAt,
          venue: order.event.venue?.name,
          address: order.event.address,
          city: order.event.city,
        },
        capturedAt: new Date().toISOString(),
      },
    },
  });
}

export async function recordConsent(input: {
  userId?: string;
  email?: string;
  purpose: "MARKETING_EMAIL" | "MARKETING_SMS" | "MARKETING_PUSH" | "ANALYTICS" | "PERSONALIZATION" | "THIRD_PARTY_SHARING";
  version: string;
  granted: boolean;
  source: string;
  ipAddress?: string;
}) {
  if (input.granted) {
    return prisma.consentRecord.create({
      data: {
        userId: input.userId,
        email: input.email?.toLowerCase(),
        purpose: input.purpose,
        version: input.version,
        grantedAt: new Date(),
        source: input.source,
        ipAddress: input.ipAddress,
      },
    });
  }

  // Withdraw latest active consent
  const latest = await prisma.consentRecord.findFirst({
    where: {
      purpose: input.purpose,
      withdrawnAt: null,
      OR: [
        input.userId ? { userId: input.userId } : undefined,
        input.email ? { email: input.email.toLowerCase() } : undefined,
      ].filter(Boolean) as object[],
    },
    orderBy: { createdAt: "desc" },
  });
  if (latest) {
    return prisma.consentRecord.update({
      where: { id: latest.id },
      data: { withdrawnAt: new Date() },
    });
  }
  return null;
}
