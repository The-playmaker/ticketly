function providerLabel(provider: string) {
  switch (provider) {
    case "NEXI":
    case "NETS":
      return "Nexi Checkout";
    case "STRIPE":
      return "Stripe";
    case "MOCK":
      return "Mock (dev)";
    default:
      return provider;
  }
}

function maskRef(ref: string | null | undefined) {
  if (!ref) return "—";
  if (ref.length <= 12) return ref;
  return `${ref.slice(0, 8)}…${ref.slice(-4)}`;
}

export type AdminPaymentAttempt = {
  id: string;
  status: string;
  provider: string;
  providerPaymentId?: string | null;
  providerSessionId?: string | null;
  providerMetadata?: unknown;
  createdAt: Date | string;
};

export function AdminPaymentAttemptsList({
  payments,
}: {
  payments: AdminPaymentAttempt[];
}) {
  return (
    <>
      {payments.map((p, idx) => {
        const meta = (p.providerMetadata ?? {}) as {
          attemptNumber?: number;
          failoverFrom?: string | null;
          failoverReason?: string | null;
        };
        const created =
          typeof p.createdAt === "string" ? p.createdAt : p.createdAt.toISOString();
        return (
          <li key={p.id}>
            Forsøk {meta.attemptNumber ?? idx + 1}: {p.status} ·{" "}
            {providerLabel(p.provider)}
            {meta.failoverFrom
              ? ` (failover fra ${providerLabel(meta.failoverFrom)})`
              : ""}{" "}
            · {created}
            <span className="ml-1 font-mono text-xs text-[color:var(--muted)]">
              {maskRef(p.providerPaymentId ?? p.providerSessionId)}
            </span>
          </li>
        );
      })}
    </>
  );
}

export { providerLabel, maskRef };
