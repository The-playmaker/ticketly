"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function kr(minor: number, currency: string) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    minor / 100
  );
}

export function OrderRefundPanel({
  orderNumber,
  refundableCount,
  totalTickets,
  pricePerTicket,
  currency,
}: {
  orderNumber: string;
  /** Unused tickets that can still be refunded */
  refundableCount: number;
  totalTickets: number;
  /** Order total / tickets incl. service fee, minor units */
  pricePerTicket: number;
  currency: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (refundableCount === 0) return null;

  const keep = totalTickets - qty;
  const amount = qty * pricePerTicket;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = data?.error;
        throw new Error(typeof err === "string" ? err : err?.message ?? "Refusjon feilet");
      }
      setMsg({
        ok: true,
        text: `Refundert ${data.refunded} billett(er) – ${kr(data.amount, data.currency)}. Kunden får pengene i løpet av 5–10 virkedager.`,
      });
      setConfirming(false);
      setQty(1);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Refusjon feilet" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
      <h2 className="text-sm font-medium text-[color:var(--muted)]">Refunder billetter</h2>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="refund-qty">Antall</Label>
          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              aria-label="Færre"
              disabled={busy || qty <= 1}
              onClick={() => {
                setQty((q) => Math.max(1, q - 1));
                setConfirming(false);
              }}
              className="h-11 w-11 p-0 text-lg"
            >
              −
            </Button>
            <span id="refund-qty" className="w-10 text-center text-lg font-semibold tabular-nums">
              {qty}
            </span>
            <Button
              type="button"
              variant="outline"
              aria-label="Flere"
              disabled={busy || qty >= refundableCount}
              onClick={() => {
                setQty((q) => Math.min(refundableCount, q + 1));
                setConfirming(false);
              }}
              className="h-11 w-11 p-0 text-lg"
            >
              +
            </Button>
            <span className="text-sm text-[color:var(--muted)]">av {refundableCount} ubrukte</span>
          </div>
        </div>
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="refund-reason">Årsak (valgfritt)</Label>
          <Input
            id="refund-reason"
            value={reason}
            maxLength={300}
            placeholder="F.eks. kjøpte for mange"
            onChange={(e) => setReason(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <p className="mt-3 text-sm">
        Refunderer <strong>{qty}</strong> billett(er) · ca. <strong>{kr(amount, currency)}</strong> tilbake
        til kunden · kunden beholder {keep} billett(er).
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {!confirming ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
            Refunder {qty}
          </Button>
        ) : (
          <>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void submit()}>
              {busy ? "Refunderer…" : `Bekreft: refunder ${kr(amount, currency)}`}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Avbryt
            </Button>
          </>
        )}
      </div>

      {msg ? (
        <p
          role="status"
          className={`mt-3 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
