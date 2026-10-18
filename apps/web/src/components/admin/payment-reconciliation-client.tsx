"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type {
  ReconciliationFilter,
  ReconciliationRow,
} from "@/services/payment-reconciliation-service";

const FILTERS: { value: ReconciliationFilter; label: string }[] = [
  { value: "discrepancies", label: "All discrepancies" },
  { value: "stripe_paid_ticketly_pending", label: "Stripe paid / Ticketly pending" },
  { value: "failed", label: "Failed" },
  { value: "blocked_review", label: "Blocked / review" },
  { value: "expired", label: "Expired" },
  { value: "refund_mismatch", label: "Refund mismatch" },
  { value: "all", label: "All candidates" },
];

type Props = {
  initialRows: ReconciliationRow[];
  initialFilter: ReconciliationFilter;
  initialScanned: number;
  initialDiscrepancies: number;
};

export function PaymentReconciliationClient({
  initialRows,
  initialFilter,
  initialScanned,
  initialDiscrepancies,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<ReconciliationFilter>(initialFilter);
  const [scanned, setScanned] = useState(initialScanned);
  const [discrepancies, setDiscrepancies] = useState(initialDiscrepancies);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.orderId)),
    [rows, selected]
  );

  const refresh = useCallback(
    (nextFilter: ReconciliationFilter) => {
      startTransition(async () => {
        setMessage(null);
        const res = await fetch(
          `/api/admin/platform/payments/reconciliation?filter=${encodeURIComponent(nextFilter)}&sinceHours=168`
        );
        if (!res.ok) {
          setMessage("Kunne ikke hente reconcileringsdata");
          return;
        }
        const data = (await res.json()) as {
          rows: ReconciliationRow[];
          scanned: number;
          discrepancies: number;
        };
        setRows(data.rows);
        setScanned(data.scanned);
        setDiscrepancies(data.discrepancies);
        setSelected(new Set());
      });
    },
    []
  );

  const reconcileIds = useCallback((orderIds: string[]) => {
    if (orderIds.length === 0) return;
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/admin/platform/payments/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, orderIds }),
      });
      if (!res.ok) {
        setMessage("Reconcile feilet");
        return;
      }
      const data = (await res.json()) as {
        applied: number;
        rows: ReconciliationRow[];
      };
      setMessage(`Oppdatert ${data.applied} ordre`);
      setRows((prev) => {
        const byId = new Map(data.rows.map((r) => [r.orderId, r]));
        return prev.map((r) => byId.get(r.orderId) ?? r);
      });
      setSelected(new Set());
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Filter</span>
          <select
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
            value={filter}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value as ReconciliationFilter;
              setFilter(v);
              refresh(v);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => refresh(filter)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          Oppdater
        </button>
        <button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() => reconcileIds([...selected])}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Reconcile selected ({selected.size})
        </button>
        <p className="text-xs text-zinc-500">
          Skannet {scanned} · Avvik {discrepancies}
          {pending ? " · arbeider…" : ""}
        </p>
      </div>

      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(new Set(rows.map((r) => r.orderId)));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Ticketly</th>
              <th className="px-3 py-2">Session</th>
              <th className="px-3 py-2">PI</th>
              <th className="px-3 py-2">Amt/Cur</th>
              <th className="px-3 py-2">Webhook</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Anomaly</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-zinc-400">
                  Ingen treff for dette filteret
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.orderId} className="align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.orderId)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.orderId);
                          else next.delete(r.orderId);
                          return next;
                        });
                      }}
                      aria-label={`Select ${r.orderNumber}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <a
                      href={`/admin/orders/${r.orderNumber}`}
                      className="underline hover:text-zinc-800"
                    >
                      {r.orderNumber}
                    </a>
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-xs">{r.customerEmail}</td>
                  <td className="px-3 py-2 text-xs">{r.ticketlyStatus}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.stripeSessionStatus ?? "—"}
                    {r.stripeSessionPaymentStatus
                      ? ` / ${r.stripeSessionPaymentStatus}`
                      : ""}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.stripePiStatus ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.amountMatch == null && r.currencyMatch == null
                      ? "—"
                      : `${r.amountMatch === false ? "amt✗" : "amt✓"} ${
                          r.currencyMatch === false ? "cur✗" : "cur✓"
                        }`}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {r.webhookLastSeenAt
                      ? new Date(r.webhookLastSeenAt).toLocaleString("nb-NO")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.proposedAction}</td>
                  <td className="px-3 py-2 text-xs text-amber-900">{r.anomalyReason ?? "—"}</td>
                  <td className="space-y-1 px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => reconcileIds([r.orderId])}
                      className="block w-full rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                    >
                      Reconcile order
                    </button>
                    {r.stripeDashboardUrl ? (
                      <a
                        href={r.stripeDashboardUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs text-sky-700 underline"
                      >
                        Open Stripe
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
