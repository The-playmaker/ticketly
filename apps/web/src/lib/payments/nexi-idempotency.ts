/** Per-attempt Idempotency-Key for Nets Easy payment create. */
export function nexiCreateIdempotencyKey(input: {
  orderId: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}): string {
  return (
    input.idempotencyKey ??
    `create_${input.orderId}_${input.metadata?.attempt ?? "1"}`
  ).slice(0, 64);
}
