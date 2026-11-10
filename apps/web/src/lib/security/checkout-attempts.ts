import { PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";

const WINDOW_MS = 60 * 60 * 1000;

function limit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Stops one buyer hammering checkout — typical of someone testing stolen
 * cards, and it also spares genuine buyers a pile of duplicate orders.
 * DB-backed so it works across serverless instances.
 *
 * Per e-mail, rolling hour:
 * - CHECKOUT_MAX_DECLINED_PER_HOUR (default 3): FAILED / REVIEW_REQUIRED
 *   (declined or blocked by Stripe Radar)
 * - CHECKOUT_MAX_ATTEMPTS_PER_HOUR (default 8): unpaid orders of any kind
 */
export async function assertCheckoutAttemptsAllowed(email: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);
  const where = {
    customerEmail: { equals: email.trim(), mode: "insensitive" as const },
    createdAt: { gte: since },
  };

  const [declined, unpaid] = await Promise.all([
    prisma.order.count({
      where: {
        ...where,
        paymentStatus: { in: [PaymentStatus.FAILED, PaymentStatus.REVIEW_REQUIRED] },
      },
    }),
    prisma.order.count({
      where: {
        ...where,
        paymentStatus: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.FAILED,
            PaymentStatus.REVIEW_REQUIRED,
            PaymentStatus.CANCELLED,
          ],
        },
      },
    }),
  ]);

  if (declined >= limit("CHECKOUT_MAX_DECLINED_PER_HOUR", 3)) {
    throw new AppError(
      "CHECKOUT_TOO_MANY_DECLINES",
      "Betalingen er avvist flere ganger. Vent en time og prøv igjen med et annet kort, eller kontakt arrangøren.",
      429
    );
  }
  if (unpaid >= limit("CHECKOUT_MAX_ATTEMPTS_PER_HOUR", 8)) {
    throw new AppError(
      "CHECKOUT_TOO_MANY_ATTEMPTS",
      "For mange påbegynte kjøp. Sjekk e-posten din for billetter, eller prøv igjen om en stund.",
      429
    );
  }
}
