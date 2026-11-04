/**
 * Ensures PromoCodeKind + PromoCode.label/kind exist in schema.prisma before
 * `prisma generate`. Also restores schema.prisma from .schema-restore/schema.zlib.b64
 * when the committed schema is a placeholder / truncated (security-audit sync).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(root, "schema.prisma");
const zlibBundle = path.join(root, ".schema-restore", "schema.zlib.b64");

function loadSchema() {
  let schema = "";
  try {
    schema = fs.readFileSync(schemaPath, "utf8");
  } catch {
    schema = "";
  }
  const broken =
    schema.length < 1000 ||
    schema.includes("PLACEHOLDER") ||
    schema.startsWith("@file:") ||
    !schema.includes("model Order");
  if (!broken) return schema;
  if (!fs.existsSync(zlibBundle)) {
    console.error(
      "apply-promoter-schema: schema broken and no .schema-restore/schema.zlib.b64"
    );
    process.exit(1);
  }
  const bytes = zlib.inflateSync(
    Buffer.from(fs.readFileSync(zlibBundle, "utf8").trim(), "base64")
  );
  const text = bytes.toString("utf8");
  if (!text.includes("promoReleasedAt") || !text.includes("model Order")) {
    console.error("apply-promoter-schema: restore bundle invalid");
    process.exit(1);
  }
  fs.writeFileSync(schemaPath, text);
  console.log(
    `apply-promoter-schema: restored schema.prisma from zlib bundle (${text.length} chars)`
  );
  return text;
}

let schema = loadSchema();

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
