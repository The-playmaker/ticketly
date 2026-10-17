/**
 * Expected QR ticket count for an order: sum(quantity × admissionCount).
 * Bundles purchase sale units; each unit yields admissionCount individual tickets.
 */
export function expectedTicketCountForItems(
  items: Array<{ quantity: number; admissionCount?: number | null }>
): number {
  return items.reduce((sum, item) => {
    const admit = Math.max(1, item.admissionCount ?? 1);
    return sum + item.quantity * admit;
  }, 0);
}
