import { AppError } from "@/lib/api-error";

export type TicketSelectionItem = { ticketTypeId: string; quantity: number };

/**
 * Merge duplicate ticketTypeId lines (sum quantities) and enforce cart limits.
 * Call before reserve / createPendingOrder so min/maxPerOrder applies to the sum.
 */
export function mergeTicketSelectionItems(
  items: TicketSelectionItem[],
  opts?: { maxLines?: number; maxQtyPerLine?: number }
): TicketSelectionItem[] {
  const maxLines = opts?.maxLines ?? 20;
  const maxQtyPerLine = opts?.maxQtyPerLine ?? 50;

  if (!items.length) {
    throw new AppError("INVALID_ITEMS", "Ingen billetter valgt", 400);
  }

  const merged = new Map<string, number>();
  for (const item of items) {
    if (!item.ticketTypeId || typeof item.ticketTypeId !== "string") {
      throw new AppError("INVALID_ITEMS", "Ugyldig billettype", 400);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new AppError("INVALID_QUANTITY", "Ugyldig antall", 400);
    }
    const next = (merged.get(item.ticketTypeId) ?? 0) + item.quantity;
    if (next > maxQtyPerLine) {
      throw new AppError(
        "INVALID_QUANTITY",
        `Maksimalt ${maxQtyPerLine} billetter per type`,
        400
      );
    }
    merged.set(item.ticketTypeId, next);
  }

  if (merged.size > maxLines) {
    throw new AppError("INVALID_ITEMS", `Maksimalt ${maxLines} billettyper per ordre`, 400);
  }

  return [...merged.entries()].map(([ticketTypeId, quantity]) => ({
    ticketTypeId,
    quantity,
  }));
}
