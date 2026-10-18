"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "preview" | "done";

type RepairTypeRow = {
  ticketTypeId: string;
  name: string;
  quantityReleased: number;
  quantitySold: number;
  currentQuantityReserved: number;
  activeTotal: number;
  activeUnexpiredTotal: number;
  expiredActiveQuantity: number;
  expiredActiveCount: number;
  proposedQuantityReserved: number;
  delta: number;
  availableBefore: number;
  availableAfter: number;
};

type ReservationRepairResult = {
  eventId: string;
  dryRun: boolean;
  now: string;
  graceMinutes: number;
  expiredCount: number;
  types: RepairTypeRow[];
  applied: boolean;
};

/**
 * SUPER_ADMIN: dry-run preview then apply reservation inventory repair.
 */
export function ReservationsRepairForm({ eventId }: { eventId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReservationRepairResult | null>(null);
  const [result, setResult] = useState<ReservationRepairResult | null>(null);

  async function runDryRun() {
    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/reservations-repair`);
      const body = (await res.json().catch(() => null)) as
        | ReservationRepairResult
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setMsg(
          (body && "error" in body ? body.error?.message : null) ??
            "Kunne ikke hente forhåndsvisning"
        );
        return;
      }
      setPreview(body as ReservationRepairResult);
      setPhase("preview");
    } finally {
      setBusy(false);
    }
  }

  async function applyRepair() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/reservations-repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const body = (await res.json().catch(() => null)) as
        | ReservationRepairResult
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setMsg(
          (body && "error" in body ? body.error?.message : null) ?? "Reparasjon feilet"
        );
        return;
      }
      setResult(body as ReservationRepairResult);
      setPreview(body as ReservationRepairResult);
      setPhase("done");
      setMsg("Reservasjoner reparert");
    } finally {
      setBusy(false);
    }
  }

  const data = result ?? preview;
  const needsWork =
    data != null && (data.expiredCount > 0 || data.types.some((t) => t.delta !== 0));

  return (
    <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
      <h2 className="font-medium">Reparere reservasjoner</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Frigjør utløpte ACTIVE-reservasjoner og setter quantityReserved eksakt fra databasen.
        Påvirker ikke solgte billetter, ordrer eller betalinger.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void runDryRun()}>
          Forhåndsvis
        </Button>
        {phase === "preview" && needsWork ? (
          <Button type="button" disabled={busy} onClick={() => void applyRepair()}>
            Bruk reparasjon
          </Button>
        ) : null}
      </div>

      {msg ? <p className="mt-3 text-sm text-amber-800">{msg}</p> : null}

      {data ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-[color:var(--muted)]">
            {data.dryRun ? "Dry-run" : "Anvendt"} · utløper {data.expiredCount} reservasjoner ·
            grace {data.graceMinutes} min
          </p>
          <ul className="space-y-2">
            {data.types.map((t) => (
              <li
                key={t.ticketTypeId}
                className="rounded-lg border border-[color:var(--outline)]/20 p-3 text-xs"
              >
                <p className="font-medium text-sm">{t.name}</p>
                <p className="mt-1 text-[color:var(--muted)]">
                  current reserved {t.currentQuantityReserved} · ACTIVE total {t.activeTotal} ·
                  ACTIVE+unexpired {t.activeUnexpiredTotal} · expire {t.expiredActiveCount} (
                  {t.expiredActiveQuantity} stk) · proposed {t.proposedQuantityReserved} · delta{" "}
                  {t.delta > 0 ? `+${t.delta}` : t.delta}
                </p>
                <p className="text-[color:var(--muted)]">
                  available {t.availableBefore} → {t.availableAfter} · sold {t.quantitySold} ·
                  released {t.quantityReleased}
                </p>
              </li>
            ))}
          </ul>
          {!needsWork ? (
            <p className="text-xs text-[color:var(--muted)]">Ingen avvik — inventaret er konsistent.</p>
          ) : null}
        </div>
      ) : phase === "idle" ? (
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Kjør forhåndsvisning for å se foreslåtte endringer per billettype.
        </p>
      ) : null}
    </section>
  );
}
