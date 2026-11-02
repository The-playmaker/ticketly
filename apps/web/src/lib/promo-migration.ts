import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/api-error";

/** True when production DB has not applied promo promoter-tracking migration. */
export function isMissingPromoMigrationError(e: unknown): boolean {
  if (e instanceof AppError && e.code === "DB_MIGRATION_REQUIRED") return true;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
    const column = String((e.meta as { column?: string } | undefined)?.column ?? e.message);
    return /PromoCode\.(label|kind)|PromoCodeKind|PromoCode/i.test(column);
  }
  return false;
}

export function rethrowMissingPromoSchema(e: unknown): never {
  if (isMissingPromoMigrationError(e)) {
    throw new AppError("DB_MIGRATION_REQUIRED", "Database-migrasjon mangler", 503, e);
  }
  throw e;
}
