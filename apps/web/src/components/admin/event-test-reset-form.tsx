"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
  type EventTestResetResult,
} from "@/lib/admin/event-test-reset";

type Phase = "idle" | "preview" | "done";

function CountsTable({
  title,
  counts,
  eventMeta,
}: {
  title: string;
  counts: EventTestResetResult["counts"];
  eventMeta?: { eventId: string; eventName: string; organizationName: string };
}) {
  const rows: Array<[string, number | string]> = [
    ["Ordrer", counts.orders],
    ["Betalte ordre", counts.paidOrders],
    ["Refunderte ordre", counts.refundedOrders],
    ["Uavklarte økonomiske ordre", counts.unsettledOrders],
    ["Betalinger", counts.payments],
    ["Refusjoner", counts.refunds],
    ["Billetter", counts.tickets],
    ["Refunderte billetter", counts.refundedTickets],
    ["Innsjekkede billetter", counts.checkedInTickets],
    ["Reservasjoner", counts.reservations],
    ["Innsjekkinger", counts.checkIns],
    ["Offline-innsjekk", counts.offlineCheckIns],
    ["Webhook-hendelser", counts.webhookEvents],
    ["Varslingslogger", counts.notificationLogs],
    ["Analytics", counts.analyticsEvents],
    ["Ordresnapshots", counts.orderSnapshots],
    ["Wallet-pass", counts.walletPasses],
    ["Venteliste", counts.waitlistEntries],
    ["Påminnelsesjobber", counts.reminderJobs],
    ["Promo-bruk", counts.promoUsages],
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {eventMeta ? (
        <p className="text-xs text-[color:var(--muted)]">
          {eventMeta.eventName} · org {eventMeta.organizationName} ·{" "}
          <code className="font-mono">{eventMeta.eventId}</code>
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-2 border-b border-[color:var(--outline)]/15 py-1"
          >
            <dt className="text-[color:var(--muted)]">{label}</dt>
            <dd className="tabular-nums font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {counts.ticketTypes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-[color:var(--muted)]">
          {counts.ticketTypes.map((t) => (
            <li key={t.id}>
              {t.name}: solgt {t.quantitySold} · reservert {t.quantityReserved} · frigitt{" "}
              {t.quantityReleased} · total {t.quantityTotal} ·{" "}
              {(t.price / 100).toLocaleString("nb-NO")} NOK
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * SUPER_ADMIN-only danger zone: dry-run → type RESET TEST EVENT → execute.
 * Primary gate: all financial orders must be fully refunded.
 */
export function EventTestResetForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<EventTestResetResult | null>(null);
  const [result, setResult] = useState<EventTestResetResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [emergencyConfirmation, setEmergencyConfirmation] = useState("");
  const [allowOverride, setAllowOverride] = useState(false);

  const gate = preview?.safetyGate ?? preview?.productionGate;

  async function runDryRun() {
    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/reset-test-data`, {
        method: "GET",
      });
      const body = (await res.json().catch(() => null)) as
        | EventTestResetResult
        | { error?: { message?: string } }
        | null;
      if (!res.ok) {
        setMsg(
          (body && "error" in body ? body.error?.message : null) ??
            "Kunne ikke hente forhåndsvisning"
        );
        return;
      }
      setPreview(body as EventTestResetResult);
      setPhase("preview");
    } finally {
      setBusy(false);
    }
  }

  async function executeReset() {
    if (confirmation !== TEST_EVENT_RESET_CONFIRMATION) {
      setMsg(`Skriv nøyaktig «${TEST_EVENT_RESET_CONFIRMATION}» for å fortsette.`);
      return;
    }
    if (
      gate?.requiresEmergencyConfirmation &&
      allowOverride &&
      emergencyConfirmation !== EMERGENCY_EVENT_RESET_CONFIRMATION
    ) {
      setMsg(
        `Skriv nøyaktig «${EMERGENCY_EVENT_RESET_CONFIRMATION}» for nødoverstyring.`
      );
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: confirmation,
          allowEmergencyOverride: allowOverride || undefined,
          emergencyConfirmation: allowOverride ? emergencyConfirmation : undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | EventTestResetResult
        | { error?: { message?: string; code?: string } }
        | null;
      if (!res.ok) {
        setMsg(
          (body && "error" in body ? body.error?.message : null) ?? "Nullstilling feilet"
        );
        return;
      }
      setResult(body as EventTestResetResult);
      setPhase("done");
      setConfirmation("");
      setEmergencyConfirmation("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function resetFlow() {
    setPhase("idle");
    setPreview(null);
    setResult(null);
    setConfirmation("");
    setEmergencyConfirmation("");
    setAllowOverride(false);
    setMsg(null);
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-[color:var(--destructive)]/35 bg-[color:var(--surface-container)] p-5 text-sm"
      data-testid="event-test-reset-form"
    >
      <div>
        <h2 className="font-medium text-[color:var(--destructive)]">Nullstill testdata</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Dette sletter lokale testordre, billetter, refusjoner, reservasjoner og analyse for
          dette arrangementet. Stripe-historikk påvirkes ikke.
        </p>
      </div>

      {phase === "idle" ? (
        <Button type="button" variant="danger" disabled={busy} onClick={runDryRun}>
          {busy ? "Henter…" : "Nullstill testdata"}
        </Button>
      ) : null}

      {phase === "preview" && preview ? (
        <div className="space-y-4">
          <CountsTable
            title="Forhåndsvisning (dry-run)"
            counts={preview.counts}
            eventMeta={{
              eventId: preview.eventId,
              eventName: preview.eventName,
              organizationName: preview.organizationName,
            }}
          />

          {gate && gate.reasons.length > 0 ? (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
              data-testid="safety-gate-warning"
            >
              <p className="font-medium">Nullstilling blokkert — uavklarte økonomiske ordre</p>
              <p className="mt-1 text-[color:var(--muted)]">
                Alle økonomiske ordre må være fullt refundert først. Reset utsteder ikke
                refusjoner.
              </p>
              <ul className="mt-1 list-inside list-disc text-[color:var(--muted)]">
                {gate.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {!gate.overrideAvailable ? (
                <p className="mt-2 text-[color:var(--muted)]">
                  Nødoverstyring krever miljøvariabelen ALLOW_PRODUCTION_EVENT_RESET=true
                  (kun nødsfall — ikke standard arbeidsflyt).
                </p>
              ) : (
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={allowOverride}
                    onChange={(e) => setAllowOverride(e.target.checked)}
                    data-testid="allow-emergency-override"
                  />
                  <span>
                    Nødoverstyring: jeg forstår at uavklarte ordre slettes lokalt uten refusjon
                    (krever ekstra bekreftelse).
                  </span>
                </label>
              )}
            </div>
          ) : (
            <p className="text-xs text-emerald-700" data-testid="safety-gate-ok">
              Alle økonomiske ordre er fullt refundert (eller ingen økonomiske ordre). Klar for
              nullstilling.
            </p>
          )}

          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-xs text-[color:var(--muted)]">
                Skriv <code className="font-mono">{TEST_EVENT_RESET_CONFIRMATION}</code> for å
                bekrefte
              </span>
              <input
                className="w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 font-mono text-sm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={TEST_EVENT_RESET_CONFIRMATION}
                autoComplete="off"
                data-testid="test-reset-confirmation"
              />
            </label>

            {allowOverride ? (
              <label className="block space-y-1">
                <span className="text-xs text-[color:var(--muted)]">
                  Nødbekreftelse:{" "}
                  <code className="font-mono">{EMERGENCY_EVENT_RESET_CONFIRMATION}</code>
                </span>
                <input
                  className="w-full rounded-md border border-amber-500/50 bg-[color:var(--surface-high)] px-3 py-2 font-mono text-sm"
                  value={emergencyConfirmation}
                  onChange={(e) => setEmergencyConfirmation(e.target.value)}
                  placeholder={EMERGENCY_EVENT_RESET_CONFIRMATION}
                  autoComplete="off"
                  data-testid="emergency-reset-confirmation"
                />
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={
                busy ||
                confirmation !== TEST_EVENT_RESET_CONFIRMATION ||
                Boolean(gate?.blocked && !allowOverride)
              }
              onClick={executeReset}
              data-testid="test-reset-execute"
            >
              {busy ? "Nullstiller…" : "Bekreft nullstilling"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetFlow}>
              Avbryt
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="space-y-3" data-testid="test-reset-summary">
          <p className="text-sm font-medium text-emerald-700">Testdata nullstilt</p>
          {result.deleted ? <CountsTable title="Slettet" counts={result.deleted} /> : null}
          <CountsTable title="Etter nullstilling" counts={result.counts} />
          <p className="text-xs text-[color:var(--muted)]">
            Bevart: arrangement, quantityTotal, quantityReleased, pris og øvrig event-konfig.
            Stripe-historikk er uendret.
          </p>
          <Button type="button" variant="outline" onClick={resetFlow}>
            Lukk
          </Button>
        </div>
      ) : null}

      {msg ? (
        <p className="text-xs text-[color:var(--destructive)]" role="alert">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
