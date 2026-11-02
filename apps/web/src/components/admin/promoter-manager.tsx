"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/utils";

export type PromoterRow = {
  id: string;
  code: string;
  label: string | null;
  kind: "DISCOUNT" | "TRACKING";
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  isActive: boolean;
  usedCount: number;
  maxUses: number | null;
  eventId: string | null;
  event: { id: string; name: string; slug: string } | null;
  trackingPath: string | null;
  trackingUrl: string | null;
  ordersCount: number;
  ticketsSold: number;
  grossSales: number;
  successfulRefundAmount: number;
  netRevenue: number;
};

function discountLabel(p: PromoterRow) {
  if (!p.discountValue) return "Kun sporing";
  if (p.discountType === "PERCENTAGE") return `${(p.discountValue / 100).toFixed(0)}%`;
  return formatMoney(p.discountValue);
}

export function PromoterManager({
  initialPromoters,
  events,
  defaultEventId,
}: {
  initialPromoters: PromoterRow[];
  events: { id: string; name: string; slug: string }[];
  defaultEventId?: string;
}) {
  const [promoters, setPromoters] = useState(initialPromoters);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const [discountPct, setDiscountPct] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const totals = useMemo(() => {
    return promoters.reduce(
      (acc, p) => ({
        orders: acc.orders + p.ordersCount,
        tickets: acc.tickets + p.ticketsSold,
        gross: acc.gross + p.grossSales,
        net: acc.net + p.netRevenue,
      }),
      { orders: 0, tickets: 0, gross: 0, net: 0 }
    );
  }, [promoters]);

  async function refresh() {
    const q = new URLSearchParams({ kind: "TRACKING" });
    if (defaultEventId) q.set("eventId", defaultEventId);
    const res = await fetch(`/api/admin/promoters?${q.toString()}`);
    if (!res.ok) return;
    const data = (await res.json()) as { promoters: PromoterRow[] };
    setPromoters(data.promoters);
  }

  async function createPromoter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const pct = discountPct.trim() ? Number(discountPct) : 0;
      const res = await fetch("/api/admin/promoters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          label: label.trim() || null,
          eventId: eventId || null,
          discountType: "PERCENTAGE",
          discountValue: pct > 0 ? Math.round(pct * 100) : 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg(err?.error?.message ?? "Kunne ikke opprette promotør");
        return;
      }
      setCode("");
      setLabel("");
      setDiscountPct("");
      await refresh();
      setMsg("Promotør opprettet — del sporingslenken");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string, isActive: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/admin/promos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(p: PromoterRow) {
    const url =
      p.trackingUrl ??
      (typeof window !== "undefined" && p.trackingPath
        ? `${window.location.origin}${p.trackingPath}`
        : null);
    if (!url) {
      setMsg("Knytt promotøren til et arrangement for å få en delingslenke");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setMsg(url);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={createPromoter}
        className="grid gap-3 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div>
          <label className="text-xs text-[color:var(--muted)]">Promotørnavn</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ola Nordmann"
          />
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">Kode</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="OLA20"
            required
          />
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">Arrangement</label>
          <select
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            required={!defaultEventId}
          >
            <option value="">Velg arrangement</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">
            Valgfri rabatt (%)
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            placeholder="0 = kun sporing"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={busy || !code.trim() || !eventId}>
            Opprett promotør
          </Button>
        </div>
      </form>

      {msg ? <p className="text-sm text-[color:var(--muted)]">{msg}</p> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Ordrer
          </p>
          <p className="mt-1 text-xl font-semibold">{totals.orders}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Billetter solgt
          </p>
          <p className="mt-1 text-xl font-semibold">{totals.tickets}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Brutto
          </p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(totals.gross)}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Netto (etter refusjon)
          </p>
          <p className="mt-1 text-xl font-semibold">{formatMoney(totals.net)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Promotør</th>
              <th className="px-4 py-3">Kode / lenke</th>
              <th className="px-4 py-3">Rabatt</th>
              <th className="px-4 py-3">Ordrer</th>
              <th className="px-4 py-3">Billetter</th>
              <th className="px-4 py-3">Brutto</th>
              <th className="px-4 py-3">Netto</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {promoters.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[color:var(--muted)]">
                  Ingen promotører ennå — opprett en kode og del sporingslenken
                </td>
              </tr>
            ) : (
              promoters.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--outline)]/20">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.label || p.code}</p>
                    {p.event ? (
                      <p className="text-xs text-[color:var(--muted)]">{p.event.name}</p>
                    ) : null}
                    {!p.isActive ? (
                      <p className="text-xs text-amber-600">Pauset</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{p.code}</p>
                    {p.trackingPath ? (
                      <button
                        type="button"
                        className="mt-1 text-xs text-[color:var(--accent)] underline"
                        onClick={() => void copyLink(p)}
                      >
                        {copiedId === p.id ? "Kopiert!" : "Kopier lenke"}
                      </button>
                    ) : (
                      <p className="mt-1 text-xs text-[color:var(--muted)]">Mangler arrangement</p>
                    )}
                  </td>
                  <td className="px-4 py-3">{discountLabel(p)}</td>
                  <td className="px-4 py-3">{p.ordersCount}</td>
                  <td className="px-4 py-3">{p.ticketsSold}</td>
                  <td className="px-4 py-3">{formatMoney(p.grossSales)}</td>
                  <td className="px-4 py-3">{formatMoney(p.netRevenue)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.isActive ? (
                      <button
                        type="button"
                        className="text-xs text-[color:var(--accent)] underline"
                        disabled={busy}
                        onClick={() => void setActive(p.id, false)}
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-[color:var(--accent)] underline"
                        disabled={busy}
                        onClick={() => void setActive(p.id, true)}
                      >
                        Aktiver
                      </button>
                    )}
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
