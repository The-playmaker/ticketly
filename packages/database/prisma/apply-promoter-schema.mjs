/**
 * Ensures PromoCodeKind + PromoCode.label/kind exist in schema.prisma before
 * `prisma generate`. Safe no-op when fields are already present (canonical tree).
 * Temporary bridge for environments where the full schema.prisma sync lags.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(root, "schema.prisma");
let schema = fs.readFileSync(schemaPath, "utf8");

if (schema.includes("enum PromoCodeKind")) {
  process.exit(0);
}

const enumNeedle = `enum DiscountType {
  PERCENTAGE
  FIXED
}

enum CheckInResult {`;

const enumInsert = `enum DiscountType {
  PERCENTAGE
  FIXED
}

/// DISCOUNT = classic promo; TRACKING = promoter attribution only (never discounts).
enum PromoCodeKind {
  DISCOUNT
  TRACKING
}

enum CheckInResult {`;

if (!schema.includes(enumNeedle)) {
  console.error("apply-promoter-schema: DiscountType/CheckInResult anchor not found");
  process.exit(1);
}
schema = schema.replace(enumNeedle, enumInsert);

const oldModel = `model PromoCode {
  id             String       @id @default(cuid())
  organizationId String
  eventId        String?
  ticketTypeId   String?
  code           String
  discountType   DiscountType
  discountValue  Int // percentage basis points (2000=20%) or fixed øre
  maxUses        Int?
  usedCount      Int          @default(0)
  startAt        DateTime?
  expiresAt      DateTime?
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  event        Event?       @relation(fields: [eventId], references: [id], onDelete: Cascade)
  ticketType   TicketType?  @relation(fields: [ticketTypeId], references: [id], onDelete: Cascade)
  orders       Order[]

  @@unique([organizationId, code])
  @@index([code])
  @@index([eventId])
  @@index([isActive])
}`;

const newModel = `model PromoCode {
  id             String        @id @default(cuid())
  organizationId String
  eventId        String?
  ticketTypeId   String?
  code           String
  /// Display name for promoter / campaign (e.g. "Ola Nordmann")
  label          String?
  kind           PromoCodeKind @default(DISCOUNT)
  discountType   DiscountType
  discountValue  Int // percentage basis points (2000=20%) or fixed øre; TRACKING always stored as 0
  maxUses        Int?
  usedCount      Int           @default(0)
  startAt        DateTime?
  expiresAt      DateTime?
  isActive       Boolean       @default(true)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  event        Event?       @relation(fields: [eventId], references: [id], onDelete: Cascade)
  ticketType   TicketType?  @relation(fields: [ticketTypeId], references: [id], onDelete: Cascade)
  orders       Order[]

  @@unique([organizationId, code])
  @@index([code])
  @@index([eventId])
  @@index([isActive])
  @@index([kind])
}`;

if (!schema.includes(oldModel)) {
  console.error("apply-promoter-schema: PromoCode model anchor not found");
  process.exit(1);
}
schema = schema.replace(oldModel, newModel);
fs.writeFileSync(schemaPath, schema);
console.log("apply-promoter-schema: patched PromoCodeKind + label/kind into schema.prisma");
