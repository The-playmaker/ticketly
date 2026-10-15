"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LivePayload = {
  inventory: {
    capacity: number;
    salesPaused: boolean;
    status: string;
    sold: number;
    available: number;
    reserved: number;
    released: number;
    types: {
      id: string;
      name: string;
      price: number;
      quantityTotal: number;
      quantityReleased: number;
      quantitySold: number;
      quantityReserved: number;
      available: number;
      unreleased: number;
      paused: boolean;
    }[];
  };
  checkedIn: number;
  refunded: number;
  today: { revenue: number; orders: number };
  totals: { grossRevenue: number; ticketsSold: number; available: number; reserved: number };
  funnel: { pageViews: number; checkoutStarts: number; paidOrders: number; conversion: number | null };
  feed: { at: string; lines: { quantity: number; name: string; total: number }[]; total: number }[];
};

function formatMoney(ore: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(
    ore / 100
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

export function EventOpsPanel({
  eventId,
  slug,
  publicUrl,
}: {
  eventId: string;
  slug: string;
  publicUrl: string;
}) {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [priceKr, setPriceKr] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${eventId}/live`);
    if (res.ok) {
      const data = (await res.json()) as LivePayload;
      setLive(data);
      setPriceKr((prev) => {
        const next = { ...prev };
        for (const t of data.inventory.types) {
          if (next[t.id] == null) next[t.id] = t.price / 100;
        }
        return next;
      });
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void fetch(`/api/admin/events/${eventId}/live`).then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LivePayload;
        if (cancelled) return;
        setLive(data);
        setPriceKr((prev) => {
          const next = { ...prev };
          for (const t of data.inventory.types) {
            if (next[t.id] == null) next[t.id] = t.price / 100;
          }
          return next;
        });
      });
    };
    const id = setInterval(tick, 8000);
    // Defer initial fetch past mount to avoid sync setState-in-effect lint
    const t = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(t);
    };
  }, [eventId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Feil");
      setMsg("Oppdatert");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Feil");
    } finally {
      setBusy(false);
    }
  }

  const primary = live?.inventory.types[0];

  return (
    <div className="space-y-6">
      {msg ? <p className="text-sm text-amber-800">{msg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {live?.inventory.salesPaused ? (
          <Button disabled={busy} onClick={() => void act({ action: "resume_sales" })}>
            Gjenoppta salg
          </Button>
        ) : (
          <Button disabled={busy} variant="danger" onClick={() => void act({ action: "pause_sales" })}>
            Pause salg
          </Button>
        )}
        {primary ? (
          <>
            <Button disabled={busy} variant="secondary" onClick={() => void act({ action: "release", ticketTypeId: primary.id, amount: 25 })}>
              Release +25
            </Button>
            <Button disabled={busy} variant="secondary" onClick={() => void act({ action: "release", ticketTypeId: primary.id, amount: 50 })}>
              Release +50
            </Button>
            <Button disabled={busy} variant="secondary" onClick={() => void act({ action: "release", ticketTypeId: primary.id, amount: 100 })}>
              Release +100
            </Button>
          </>
        ) : null}
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(publicUrl);
            setMsg("Lenke kopiert");
          }}
        >
          Kopier lenke
        </Button>
        <Button asChild variant="outline">
          <Link href={`/events/${slug}`} target="_blank">
            Se event
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/scan?event=${eventId}`}>Scan</Link>
        </Button>
      </div>

      {live ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Solgt" value={`${live.totals.ticketsSold} / ${live.inventory.capacity}`} />
            <Stat label="Omsetning" value={formatMoney(live.totals.grossRevenue)} />
            <Stat label="Tilgjengelig" value={String(live.totals.available)} />
            <Stat label="Reservert" value={String(live.totals.reserved)} />
            <Stat label="Innsjekket" value={String(live.checkedIn)} />
            <Stat label="Refundert" value={String(live.refunded)} />
            <Stat label="I dag" value={`${live.today.orders} ord. · ${formatMoney(live.today.revenue)}`} />
            <Stat
              label="Konvertering"
              value={live.funnel.conversion != null ? `${live.funnel.conversion}%` : "—"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="mb-3 font-semibold">Live salg</h3>
              <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                {live.feed.length === 0 ? (
                  <li className="text-zinc-500">Ingen betalte ordrer ennå</li>
                ) : (
                  live.feed.map((f, i) => (
                    <li key={i} className="flex justify-between gap-3 border-b border-zinc-100 py-2">
                      <span className="text-zinc-500">{formatTime(f.at)}</span>
                      <span className="flex-1">
                        {f.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}
                      </span>
                      <span className="font-medium">{formatMoney(f.total)}</span>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="mb-3 font-semibold">Inventory & pris</h3>
              <ul className="space-y-4">
                {live.inventory.types.map((t) => (
                  <li key={t.id} className="rounded-lg border border-zinc-100 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{t.name}</p>
                        <p className="text-zinc-500">
                          Released {t.quantityReleased}/{t.quantityTotal} · Solgt {t.quantitySold} ·
                          Res {t.quantityReserved} · Ledig {t.available} · Urelease {t.unreleased}
                        </p>
                        <p className="text-zinc-500">Pris {formatMoney(t.price)}</p>
                      </div>
                      {t.paused ? (
                        <Button size="sm" disabled={busy} onClick={() => void act({ action: "resume_ticket_type", ticketTypeId: t.id })}>
                          Resume
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "pause_ticket_type", ticketTypeId: t.id })}>
                          Pause type
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div>
                        <label className="text-xs text-zinc-500">Ny pris (kr)</label>
                        <Input
                          type="number"
                          className="w-28"
                          value={priceKr[t.id] ?? t.price / 100}
                          onChange={(e) => setPriceKr((p) => ({ ...p, [t.id]: Number(e.target.value) }))}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void act({
                            action: "change_price",
                            ticketTypeId: t.id,
                            newPrice: Math.round((priceKr[t.id] ?? t.price / 100) * 100),
                            reason: "Admin quick change",
                          })
                        }
                      >
                        Endre pris
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
            <h3 className="mb-2 font-semibold">Funnel</h3>
            <p>
              {live.funnel.pageViews} views → {live.funnel.checkoutStarts} checkout →{" "}
              {live.funnel.paidOrders} betalt
              {live.funnel.conversion != null ? ` (${live.funnel.conversion}%)` : ""}
            </p>
          </section>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Laster live data…</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
