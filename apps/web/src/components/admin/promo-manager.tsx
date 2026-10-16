"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PromoRow = {
  id: string;
  code: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  usedCount: number;
  maxUses: number | null;
  startAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  event?: { id: string; name: string } | null;
  ticketType?: { id: string; name: string } | null;
};

function discountLabel(p: PromoRow) {
  if (p.discountType === "PERCENTAGE") return `${(p.discountValue / 100).toFixed(0)}%`;
  return `${(p.discountValue / 100).toFixed(0)} NOK`;
}

function statusLabel(p: PromoRow) {
  if (!p.isActive) return "Pauset";
  const now = Date.now();
  if (p.startAt && new Date(p.startAt).getTime() > now) return "Planlagt";
  if (p.expiresAt && new Date(p.expiresAt).getTime() < now) return "Utløpt";
  if (p.maxUses != null && p.usedCount >= p.maxUses) return "Oppbrukt";
  return "Aktiv";
}

export function PromoManager({
  initialPromos,
  events,
}: {
  initialPromos: PromoRow[];
  events: { id: string; name: string }[];
}) {
  const [promos, setPromos] = useState(initialPromos);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("20");
  const [maxUses, setMaxUses] = useState("");
  const [eventId, setEventId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/admin/promos");
    if (!res.ok) return;
    const data = (await res.json()) as { promos: PromoRow[] };
    setPromos(
      data.promos.map((p) => ({
        ...p,
        startAt: p.startAt ? String(p.startAt) : null,
        expiresAt: p.expiresAt ? String(p.expiresAt) : null,
      }))
    );
  }

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const raw = Number(discountValue);
      const value = discountType === "PERCENTAGE" ? Math.round(raw * 100) : Math.round(raw * 100);
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          discountType,
          discountValue: value,
          maxUses: maxUses ? Number(maxUses) : null,
          eventId: eventId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg(err?.error?.message ?? "Kunne ikke opprette");
        return;
      }
      setCode("");
      setMaxUses("");
      await refresh();
      setMsg("Kampanjekode opprettet");
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

  return (
    <div className="space-y-6">
      <form
        onSubmit={createPromo}
        className="grid gap-3 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div>
          <label className="text-xs text-[color:var(--muted)]">Kode</label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VIP20" required />
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">Type</label>
          <select
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as "PERCENTAGE" | "FIXED")}
          >
            <option value="PERCENTAGE">Prosent</option>
            <option value="FIXED">Fast beløp (NOK)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">
            {discountType === "PERCENTAGE" ? "Prosent" : "Beløp (NOK)"}
          </label>
          <Input
            type="number"
            min={1}
            step={discountType === "PERCENTAGE" ? 1 : 1}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">Maks bruk (valgfritt)</label>
          <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[color:var(--muted)]">Arrangement (valgfritt)</label>
          <select
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">Hele organisasjonen</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={busy || !code.trim()}>
            Opprett
          </Button>
        </div>
      </form>

      {msg ? <p className="text-sm text-[color:var(--muted)]">{msg}</p> : null}

      <div className="overflow-hidden rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Kode</th>
              <th className="px-4 py-3">Rabatt</th>
              <th className="px-4 py-3">Brukt</th>
              <th className="px-4 py-3">Grense</th>
              <th className="px-4 py-3">Starter</th>
              <th className="px-4 py-3">Utløper</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {promos.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[color:var(--muted)]">
                  Ingen kampanjekoder ennå
                </td>
              </tr>
            ) : (
              promos.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--outline)]/20">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3">{discountLabel(p)}</td>
                  <td className="px-4 py-3">{p.usedCount}</td>
                  <td className="px-4 py-3">{p.maxUses ?? "∞"}</td>
                  <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                    {p.startAt ? new Date(p.startAt).toLocaleDateString("nb-NO") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                    {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("nb-NO") : "—"}
                  </td>
                  <td className="px-4 py-3">{statusLabel(p)}</td>
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
