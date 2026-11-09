import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Prisma defaults are maxWait 2 s / timeout 5 s. During a sales rush every
    // fulfillment locks the same TicketType row, so transactions queued past
    // 5 s and were rolled back: Stripe had the money, Ticketly had PENDING or
    // PAID-without-tickets. Allow time to wait for the lock instead.
    transactionOptions: {
      maxWait: 15_000,
      timeout: 30_000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export default prisma;
