import { z } from "zod";

/** Strong password: min 12 chars, no silly complexity rules. */
export const strongPasswordSchema = z
  .string()
  .min(12, "Passordet må være minst 12 tegn");

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: strongPasswordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
  marketingOptIn: z.boolean().optional().default(false),
});

export const setPasswordSchema = z.object({
  token: z.string().min(16),
  password: strongPasswordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const checkoutContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(30).optional(),
  createAccount: z.boolean().optional(),
  password: strongPasswordSchema.optional(),
  promoCode: z.string().optional(),
  /** Explicit acceptance of purchase terms version shown at checkout */
  termsVersion: z.string().min(1),
  termsAccepted: z.literal(true),
  /** Marketing must NEVER be pre-checked; omit or false by default */
  marketingOptIn: z.boolean().optional().default(false),
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

export const checkInSchema = z.object({
  token: z.string().min(16),
  eventId: z.string().min(1),
  deviceId: z.string().optional(),
});

export const offlineSyncSchema = z.object({
  eventId: z.string(),
  deviceId: z.string(),
  checkIns: z.array(
    z.object({
      localId: z.string().uuid(),
      sequenceNumber: z.number().int().min(0),
      ticketPublicId: z.string(),
      ticketTokenHash: z.string(),
      staffUserId: z.string().optional(),
      localCheckedInAt: z.string().datetime(),
      result: z.enum([
        "SUCCESS",
        "ALREADY_USED",
        "INVALID",
        "WRONG_EVENT",
        "CANCELLED",
        "REFUNDED",
        "EVENT_CANCELLED",
      ]),
    })
  ),
});

export const deviceRegisterSchema = z.object({
  organizationId: z.string(),
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  appVersion: z.string().optional(),
  pushToken: z.string().optional(),
});

export const notificationPrefSchema = z.object({
  channel: z.enum(["PUSH", "EMAIL", "SMS"]),
  category: z.enum(["TRANSACTIONAL", "SERVICE", "MARKETING"]),
  enabled: z.boolean(),
});

export const consentSchema = z.object({
  purpose: z.enum([
    "MARKETING_EMAIL",
    "MARKETING_SMS",
    "MARKETING_PUSH",
    "ANALYTICS",
    "PERSONALIZATION",
    "THIRD_PARTY_SHARING",
  ]),
  version: z.string(),
  granted: z.boolean(),
});
