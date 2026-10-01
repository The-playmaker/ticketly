import { prisma } from "@/lib/db";

/**
 * Generates human-readable order numbers: TKT-2026-000124
 * Uses a dedicated sequence table with row-level locking.
 */
export async function generateOrderNumber(year = new Date().getUTCFullYear()): Promise<string> {
  const key = String(year);
  const seq = await prisma.$transaction(async (tx) => {
    const existing = await tx.orderSequence.findUnique({ where: { id: key } });
    if (!existing) {
      return tx.orderSequence.create({ data: { id: key, counter: 1 } });
    }
    return tx.orderSequence.update({
      where: { id: key },
      data: { counter: { increment: 1 } },
    });
  });
  return `TKT-${year}-${String(seq.counter).padStart(6, "0")}`;
}
