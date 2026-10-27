import { z } from "zod";
import { emailSchema, EMAIL_MESSAGES, normalizeEmail } from "@ticketly/validation";

export { emailSchema, EMAIL_MESSAGES, normalizeEmail, emailTypoHint, suggestEmailTypo } from "@ticketly/validation";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
});

export const checkoutContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: emailSchema,
  /** Optional confirm — when present must match email after normalize. */
  emailConfirm: z.string().optional(),
  phone: z.string().min(5).max(30).optional(),
  createAccount: z.boolean().optional(),
  password: z.string().min(8).optional(),
  promoCode: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.emailConfirm == null || val.emailConfirm === "") return;
  if (normalizeEmail(val.emailConfirm) !== val.email) {
    ctx.addIssue({
      code: "custom",
      path: ["emailConfirm"],
      message: EMAIL_MESSAGES.mismatch,
    });
  }
});

export const ticketSelectionSchema = z.object({
  eventId: z.string().min(1),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
      })
    )
    .min(1),
  sessionId: z.string().min(8),
});

export const createEventSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  shortDescription: z.string().max(300).optional(),
  venueId: z.string().optional(),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default("NO"),
  timezone: z.string().default("Europe/Oslo"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  doorsOpenAt: z.string().datetime().optional(),
  ageLimit: z.number().int().min(0).max(99).optional(),
  capacity: z.number().int().min(1),
  visibility: z.enum(["PUBLIC", "UNLISTED", "HIDDEN"]).default("PUBLIC"),
  salesStartAt: z.string().datetime().optional(),
  salesEndAt: z.string().datetime().optional(),
  allowTransfer: z.boolean().default(false),
  coverImageUrl: z.string().url().optional(),
});

export const ticketTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  price: z.number().int().min(0),
  vatRate: z.number().int().min(0).max(10000).default(2500),
  serviceFee: z.number().int().min(0).optional(),
  quantityTotal: z.number().int().min(0),
  maxPerOrder: z.number().int().min(1).default(10),
  minPerOrder: z.number().int().min(1).default(1),
  salesStartAt: z.string().datetime().optional(),
  salesEndAt: z.string().datetime().optional(),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  priceTiers: z
    .array(
      z.object({
        name: z.string().optional(),
        price: z.number().int().min(0),
        quantityFrom: z.number().int().min(0),
        quantityTo: z.number().int().min(0),
        sortOrder: z.number().int().default(0),
      })
    )
    .optional(),
});

export const promoValidateSchema = z.object({
  code: z.string().min(1),
  eventId: z.string(),
  subtotal: z.number().int().min(0),
});

export const checkInSchema = z.object({
  token: z.string().min(16),
  eventId: z.string().min(1),
  deviceId: z.string().optional(),
});

export const manualCheckInSchema = z.object({
  ticketId: z.string().min(1),
  eventId: z.string().min(1),
  deviceId: z.string().optional(),
  note: z.string().max(500).optional(),
  /** Elevated re-entry when ticket already checked in */
  forceOverride: z.boolean().optional(),
});

export const guestListSchema = z.object({
  eventId: z.string(),
  name: z.string().min(1),
  email: emailSchema.optional(),
  phone: z.string().optional(),
  comment: z.string().optional(),
  partySize: z.number().int().min(1).max(20).default(1),
  ticketTypeId: z.string().optional(),
});

export const transferTicketSchema = z.object({
  ticketId: z.string(),
  toName: z.string().min(1),
  toEmail: emailSchema,
});

export const mintDynamicQrSchema = z.object({
  ticketId: z.string().min(1),
  /** Order access token — alternative to logged-in holder session */
  accessToken: z.string().min(32).optional(),
});

export const refundSchema = z.object({
  orderId: z.string(),
  ticketIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});
