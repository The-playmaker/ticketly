import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  nexiCredentialStatuses,
  nexiConfigHealth,
  stripeConfigHealth,
  resolvePaymentProviderType,
} from "@/lib/payments";
import { PaymentProviderType, PaymentStatus, RefundStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
          : "rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
      }
    >
      {label}
    </span>
  );
}

function ProviderTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <dl className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-6 py-3 text-sm first:pt-0 last:pb-0"
          >
            <dt className="shrink-0 text-zinc-500">{row.label}</dt>
            <dd className="min-w-0 text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function PaymentDiagnosticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/platform/payments/diagnostics");

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };

  if (!isSuperAdmin(user)) {
    redirect("/admin");
  }

  const activeProvider = (() => {
    try {
      return resolvePaymentProviderType();
    } catch (e) {
      return e instanceof Error ? e.message : "error";
    }
  })();

  const creds = nexiCredentialStatuses();
  const nexiHealth = nexiConfigHealth();
  const stripeHealth = stripeConfigHealth();

  let databaseStatus: "Connected" | "Error" = "Connected";
  let databaseError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    databaseStatus = "Error";
    databaseError = e instanceof Error ? e.message : "Database unreachable";
  }

  const [lastNexiWebhook, lastStripeWebhook, lastNexiPayment, lastStripePayment, lastRefund] =
    await Promise.all([
      prisma.webhookEvent.findFirst({
        where: { provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] } },
        orderBy: { receivedAt: "desc" },
        select: {
          eventType: true,
          status: true,
          receivedAt: true,
        },
      }),
      prisma.webhookEvent.findFirst({
        where: { provider: PaymentProviderType.STRIPE },
        orderBy: { receivedAt: "desc" },
        select: {
          eventType: true,
          status: true,
          receivedAt: true,
        },
      }),
      prisma.payment.findFirst({
        where: {
          provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
          status: { in: [PaymentStatus.PAID, PaymentStatus.AUTHORIZED] },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          updatedAt: true,
          paymentMethod: true,
          order: { select: { orderNumber: true } },
        },
      }),
      prisma.payment.findFirst({
        where: {
          provider: PaymentProviderType.STRIPE,
          status: { in: [PaymentStatus.PAID, PaymentStatus.AUTHORIZED] },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          updatedAt: true,
          paymentMethod: true,
          order: { select: { orderNumber: true } },
        },
      }),
      prisma.refund.findFirst({
        where: { status: { in: [RefundStatus.SUCCEEDED, RefundStatus.PENDING, RefundStatus.FAILED] } },
        orderBy: { updatedAt: "desc" },
        select: {
          status: true,
          updatedAt: true,
          order: { select: { orderNumber: true } },
          payment: { select: { provider: true } },
        },
      }),
    ]);

  const nexiActive =
    activeProvider === PaymentProviderType.NEXI || activeProvider === PaymentProviderType.NETS;
  const stripeActive = activeProvider === PaymentProviderType.STRIPE;

  const nexiLabel =
    nexiHealth.status === "operational"
      ? nexiActive
        ? "Operational (active for new checkouts)"
        : "Operational"
      : creds.secretApiKey === "Configured"
        ? "Configuration Error"
        : "Pending onboarding";

  const stripeLabel =
    stripeHealth.status === "operational"
      ? stripeActive
        ? "Operational (active for new checkouts)"
        : "Operational"
      : "Not configured";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Platform · Payments
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Payment diagnostics</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Providers reported separately. No automatic failover. Active provider is set via{" "}
          <code className="text-xs">PAYMENT_PROVIDER</code>.{" "}
          <Link href="/admin/webhooks" className="underline hover:text-zinc-800">
            Webhook monitor
          </Link>
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <dl className="divide-y divide-zinc-100 text-sm">
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-zinc-500">Active PAYMENT_PROVIDER</dt>
            <dd className="font-mono text-xs">{String(activeProvider)}</dd>
          </div>
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-zinc-500">Database</dt>
            <dd>
              <StatusPill ok={databaseStatus === "Connected"} label={databaseStatus} />
              {databaseError ? (
                <span className="mt-1 block max-w-xs text-right text-xs text-red-600">
                  {databaseError}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex justify-between gap-6 py-3">
            <dt className="text-zinc-500">Last refund (any provider)</dt>
            <dd className="text-right text-xs">
              {lastRefund ? (
                <>
                  <div>{lastRefund.updatedAt.toISOString()}</div>
                  <div className="text-zinc-500">
                    {lastRefund.order.orderNumber} · {lastRefund.payment?.provider ?? "?"} ·{" "}
                    {lastRefund.status}
                  </div>
                </>
              ) : (
                <span className="text-zinc-400">None</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <ProviderTable
        title="Nexi Checkout"
        rows={[
          {
            label: "Status",
            value: (
              <StatusPill ok={nexiHealth.status === "operational"} label={nexiLabel} />
            ),
          },
          {
            label: "Environment",
            value: creds.environment === "test" ? "TEST" : "PRODUCTION",
          },
          {
            label: "API configuration",
            value: (
              <StatusPill
                ok={creds.secretApiKey === "Configured"}
                label={creds.secretApiKey}
              />
            ),
          },
          {
            label: "Checkout key",
            value: (
              <StatusPill ok={creds.checkoutKey === "Configured"} label={creds.checkoutKey} />
            ),
          },
          {
            label: "Webhook secret",
            value: (
              <StatusPill ok={creds.webhookSecret === "Configured"} label={creds.webhookSecret} />
            ),
          },
          {
            label: "Webhook endpoint",
            value: creds.webhookEndpoint ? (
              <span className="break-all font-mono text-xs">{creds.webhookEndpoint}</span>
            ) : (
              <StatusPill ok={false} label="Missing" />
            ),
          },
          {
            label: "Last webhook",
            value: lastNexiWebhook ? (
              <span className="text-right text-xs">
                <div>{lastNexiWebhook.receivedAt.toISOString()}</div>
                <div className="text-zinc-500">
                  {lastNexiWebhook.eventType} · {lastNexiWebhook.status}
                </div>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">None</span>
            ),
          },
          {
            label: "Last successful payment",
            value: lastNexiPayment ? (
              <span className="text-right text-xs">
                <div>{lastNexiPayment.updatedAt.toISOString()}</div>
                <div className="text-zinc-500">
                  {lastNexiPayment.order.orderNumber}
                  {lastNexiPayment.paymentMethod ? ` · ${lastNexiPayment.paymentMethod}` : ""}
                </div>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">None</span>
            ),
          },
        ]}
      />

      <ProviderTable
        title="Stripe"
        rows={[
          {
            label: "Status",
            value: (
              <StatusPill ok={stripeHealth.status === "operational"} label={stripeLabel} />
            ),
          },
          {
            label: "Mode",
            value: stripeHealth.mode.toUpperCase(),
          },
          {
            label: "Active for new checkouts",
            value: stripeActive ? "Yes" : "No",
          },
          {
            label: "Webhook endpoint",
            value: (
              <span className="break-all font-mono text-xs">
                {(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/payments/stripe/webhook
              </span>
            ),
          },
          {
            label: "Last webhook",
            value: lastStripeWebhook ? (
              <span className="text-right text-xs">
                <div>{lastStripeWebhook.receivedAt.toISOString()}</div>
                <div className="text-zinc-500">
                  {lastStripeWebhook.eventType} · {lastStripeWebhook.status}
                </div>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">None</span>
            ),
          },
          {
            label: "Last successful payment",
            value: lastStripePayment ? (
              <span className="text-right text-xs">
                <div>{lastStripePayment.updatedAt.toISOString()}</div>
                <div className="text-zinc-500">
                  {lastStripePayment.order.orderNumber}
                  {lastStripePayment.paymentMethod ? ` · ${lastStripePayment.paymentMethod}` : ""}
                </div>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">None</span>
            ),
          },
        ]}
      />
    </div>
  );
}
