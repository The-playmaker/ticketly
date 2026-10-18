import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";
import { PaymentReconciliationClient } from "@/components/admin/payment-reconciliation-client";
import { stripeConfigHealth } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function PaymentReconciliationPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/admin/platform/payments/reconciliation");
  }

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

  const stripeHealth = stripeConfigHealth();

  let initial;
  try {
    initial = await PaymentReconciliationService.reconcile({
      apply: false,
      filter: "discrepancies",
      sinceHours: 168,
      limit: 100,
      concurrency: 5,
    });
  } catch {
    initial = {
      dryRun: true,
      scanned: 0,
      applied: 0,
      discrepancies: 0,
      rows: [],
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Platform · Payments
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Payment reconciliation</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Stripe er autoritativ for betalingsstatus. Ticketly for ordre/billetter.{" "}
          <Link
            href="/admin/platform/payments/diagnostics"
            className="underline hover:text-zinc-800"
          >
            Diagnostikk
          </Link>
        </p>
        {stripeHealth.status !== "operational" ? (
          <p className="mt-2 text-sm text-amber-800">
            Stripe er ikke konfigurert — oppslag kan feile ({stripeHealth.message}).
          </p>
        ) : null}
      </div>

      <PaymentReconciliationClient
        initialRows={initial.rows}
        initialFilter="discrepancies"
        initialScanned={initial.scanned}
        initialDiscrepancies={initial.discrepancies}
      />
    </div>
  );
}
