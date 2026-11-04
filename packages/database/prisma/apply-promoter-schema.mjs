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

enum CheckInResult `;
