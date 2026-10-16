import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentProviderType } from "@prisma/client";
import { WebhookReplayButton } from "@/components/admin/webhook-replay-button";

export default async function AdminWebhooksPage() {
  await auth();
  const events = await prisma.webhookEvent.findMany({
    where: {
      provider: {
        in: [
          PaymentProviderType.NEXI,
          PaymentProviderType.NETS,
          PaymentProviderType.STRIPE,
          PaymentProviderType.MOCK,
        ],
      },
    },
    orderBy: { receivedAt: "desc" },
    take: 80,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Webhook-monitor</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Nexi / Stripe events. Replay kjører kun vår egen idempotente prosessering.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Payment ID</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Processed</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-[color:var(--outline)]/20">
                <td className="px-3 py-2 font-mono text-xs">{e.provider}</td>
                <td className="px-3 py-2 text-xs">{e.eventType}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.paymentId ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.orderId ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{e.receivedAt.toISOString()}</td>
                <td className="px-3 py-2 text-xs">
                  {e.processedAt ? e.processedAt.toISOString() : "—"}
                </td>
                <td className="px-3 py-2">{e.status}</td>
                <td className="max-w-[180px] truncate px-3 py-2 text-xs text-red-600">
                  {e.error ?? ""}
                </td>
                <td className="px-3 py-2">
                  {e.status === "FAILED" || e.status === "RECEIVED" ? (
                    <WebhookReplayButton webhookEventId={e.id} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
