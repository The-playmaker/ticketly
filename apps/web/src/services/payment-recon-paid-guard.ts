import { PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

/** Never apply mark_failed when order is already paid-like. */
export async function skipFailedIfAlreadyPaid(input: {
  orderId: string;
  organizationId: string;
  actorId?: string;
  providerPaymentId?: string | null;
}): Promise<{ skip: true; detail: string } | { skip: false }> {
  const current = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { paymentStatus: true },
  });
  if (
    current &&
    (current.paymentStatus === PaymentStatus.PAID ||
      current.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
      current.paymentStatus === PaymentStatus.REFUNDED)
  ) {
    await writeAuditLog({
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: "PAYMENT_RECONCILED",
      entityType: "Order",
      entityId: input.orderId,
      metadata: {
        action: "skip_failed_already_paid",
        keptStatus: current.paymentStatus,
        providerPaymentId: input.providerPaymentId ?? null,
      },
    });
    return { skip: true, detail: "will_not_downgrade_paid" };
  }
  return { skip: false };
}
