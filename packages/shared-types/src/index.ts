/**
 * @ticketly/shared-types
 * Shared domain types for web, mobile, and API.
 * Prefer Prisma enums where possible; this package holds DTO / cross-cutting contracts.
 */

export type PartyRole =
  | "PLATFORM"
  | "ORGANIZER"
  | "SELLER_OF_RECORD"
  | "PAYMENT_PROVIDER"
  | "CUSTOMER";

export type RefundPolicyType =
  | "STATUTORY_CANCELLATION_RIGHT"
  | "ORGANIZER_REFUND_POLICY"
  | "EVENT_CANCELLED_REFUND"
  | "MANUAL_REFUND"
  | "NO_REFUND";

export type ConsentPurpose =
  | "MARKETING_EMAIL"
  | "MARKETING_SMS"
  | "MARKETING_PUSH"
  | "ANALYTICS"
  | "PERSONALIZATION"
  | "THIRD_PARTY_SHARING";

export type NotificationCategory = "TRANSACTIONAL" | "SERVICE" | "MARKETING";

export type ScanResultCode =
  | "SUCCESS"
  | "ALREADY_USED"
  | "INVALID"
  | "WRONG_EVENT"
  | "CANCELLED"
  | "REFUNDED"
  | "EVENT_CANCELLED";

/** Minimal offline validation entry — no PII */
export type OfflineTicketEntry = {
  publicId: string;
  tokenHash: string;
  status: "VALID" | "CHECKED_IN" | "CANCELLED" | "REFUNDED";
  ticketTypeName: string;
};

export type OfflineCheckInPayload = {
  localId: string;
  sequenceNumber: number;
  eventId: string;
  ticketPublicId: string;
  ticketTokenHash: string;
  deviceId?: string;
  staffUserId?: string;
  localCheckedInAt: string; // ISO
  result: ScanResultCode;
};

export type SellerOfRecordInfo = {
  legalName: string;
  organizationNumber?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country: string;
  customerServiceEmail?: string | null;
  customerServicePhone?: string | null;
  vatRegistrationStatus: string;
  termsVersion: string;
};

export type CheckoutDisclosure = {
  eventName: string;
  eventStartsAt: string;
  venue: string;
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
  currency: string;
  seller: SellerOfRecordInfo;
  refundPolicyType: RefundPolicyType;
  refundPolicyText?: string | null;
  termsVersion: string;
};

export type SettlementBreakdown = {
  grossTicketAmountOre: number;
  organizerAmountOre: number;
  platformFeeOre: number;
  paymentProcessingFeeOre: number;
  taxOre: number;
  refundOre: number;
};

/** Wallet pass — real issuance only when credentials configured */
export type WalletProviderKind = "APPLE" | "GOOGLE";
