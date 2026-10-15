import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  nexiCredentialStatuses,
  nexiConfigHealth,
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

  const provider = (() => {
    try {
      return resolvePaymentProviderType();
    } catch (e) {
      return e instanceof Error ? e.message : "error";
    }
  })();

  const creds = nexiCredentialStatuses();
  const nexiHealth = nexiConfigHealth();

  let databaseStatus: "Connected" | "Error" = "Connected";
  let databaseError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    databaseStatus = "Error";
    databaseError = e instanceof Error ? e.message : "Database unreachable";
  }

  const lastWebhook = await prisma.webhookEvent.findFirst({
    where: {
      provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
    },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      eventType: true,
      status: true,
      receivedAt: true,
      processedAt: true,
      orderId: true,
      error: true,
    },
  });

  const lastSuccessfulPayment = await prisma.payment.findFirst({
    where: {
      provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
      status: { in: [PaymentStatus.PAID, PaymentStatus.AUTHORIZED] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      updatedAt: true,
      paymentMethod: true,
      amount: true,
      currency: true,
      order: { select: { orderNumber: true, id: true } },
    },
  });

  const lastRefund = await prisma.refund.findFirst({
    where: { status: { in: [RefundStatus.SUCCEEDED, RefundStatus.PENDING, RefundStatus.FAILED] } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      updatedAt: true,
      order: { select: { orderNumber: true } },
    },
  });

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Provider", value: "Nexi Checkout" },
    { label: "Environment", value: creds.environment === "test" ? "TEST" : "PRODUCTION" },
    {
      label: "Active PAYMENT_PROVIDER",
      value: <span className="font-mono text-xs">{String(provider)}</span>,
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
      label: "APP_URL",
      value: <StatusPill ok={creds.appUrl === "Configured"} label={creds.appUrl} />,
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
      label: "Database",
      value: (
        <span className="inline-flex flex-col items-end gap-1">
          <StatusPill ok={databaseStatus === "Connected"} label={databaseStatus} />
          {databaseError ? (
            <span className="max-w-xs text-right text-xs text-red-600">{databaseError}</span>
          ) : null}
        </span>
      ),
    },
    {
      label: "Nexi health",
      value:
        nexiHealth.status === "operational" ? (
          <StatusPill ok label="Operational" />
        ) : (
          <span className="inline-flex flex-col items-end gap-1">
            <StatusPill ok={false} label="Configuration Error" />
            {nexiHealth.message ? (
              <span className="max-w-xs text-right text-xs text-amber-800">{nexiHealth.message}</span>
            ) : null}
          </span>
        ),
    },
    {
      label: "Last webhook",
      value: lastWebhook ? (
        <span className="text-right text-xs">
          <div>{lastWebhook.receivedAt.toISOString()}</div>
          <div className="text-zinc-500">
            {lastWebhook.eventType} · {lastWebhook.status}
          </div>
        </span>
      ) : (
        <span className="text-xs text-zinc-400">None</span>
      ),
    },
    {
      label: "Last successful payment",
      value: lastSuccessfulPayment ? (
        <span className="text-right text-xs">
          <div>{lastSuccessfulPayment.updatedAt.toISOString()}</div>
          <div className="text-zinc-500">
            {lastSuccessfulPayment.order.orderNumber}
            {lastSuccessfulPayment.paymentMethod
              ? ` · ${lastSuccessfulPayment.paymentMethod}`
              : ""}
          </div>
        </span>
      ) : (
        <span className="text-xs text-zinc-400">None</span>
      ),
    },
    {
      label: "Last refund",
      value: lastRefund ? (
        <span className="text-right text-xs">
          <div>{lastRefund.updatedAt.toISOString()}</div>
          <div className="text-zinc-500">
            {lastRefund.order.orderNumber} · {lastRefund.status}
          </div>
        </span>
      ) : (
        <span className="text-xs text-zinc-400">None</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Platform · Payments
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Payment diagnostics</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Configured / Missing only — secret values are never shown.{" "}
          <Link href="/admin/webhooks" className="underline hover:text-zinc-800">
            Webhook monitor
          </Link>
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
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
    </div>
  );
}
