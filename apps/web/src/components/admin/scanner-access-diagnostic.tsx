"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { orgRoleLabel } from "@/lib/auth/role-labels";

type DiagnosticResult = {
  user: {
    id: string;
    email: string;
    name: string | null;
    isActive: boolean;
    globalRole: string;
    doorStaffOnly: boolean;
  };
  memberships: {
    organizationId: string;
    organizationName: string;
    role: string;
    membershipActive: boolean;
    canScanOrg: boolean;
  }[];
  eventAssignments: {
    eventId: string;
    eventName: string;
    organizationId: string;
    eventStatus: string;
    salesPausedAt: string | Date | null;
    scannerAccess: "allowed" | "denied";
    reason: string;
  }[];
  scannerVisibleEvents: {
    id: string;
    name: string;
    status: string;
    organizationId: string;
  }[];
  scannerAccess: "allowed" | "denied";
  reason: string;
  notes: {
    scannableStatuses: string[];
    dualDomain: string;
  };
};

export function ScannerAccessDiagnostic({
  organizationId,
}: {
  organizationId?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const params = new URLSearchParams();
    if (email.trim()) params.set("email", email.trim());
    if (organizationId) params.set("organizationId", organizationId);
    const res = await fetch(
      `/api/admin/team/scanner-diagnostic?${params.toString()}`
    );
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Diagnostikk feilet");
      return;
    }
    setResult((await res.json()) as DiagnosticResult);
  }

  return (
    <section className="rounded-xl border border-[color:var(--outline)]/35 p-5">
      <h2 className="font-medium">Scanner-tilgang diagnostikk</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Sjekk EventAssignment, org-rolle og event-status for en bruker (f.eks. når
        Team viser tildeling men /scan sier «Ingen arrangementer»).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="scanner-diag-email">E-post</Label>
          <Input
            id="scanner-diag-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="door@example.com"
          />
        </div>
        <Button disabled={busy || !email.trim()} onClick={run}>
          {busy ? "Sjekker…" : "Diagnoser"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}

      {result ? (
        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={result.scannerAccess === "allowed" ? "success" : "warning"}
            >
              {result.scannerAccess === "allowed" ? "ALLOWED" : "DENIED"}
            </Badge>
            <span className="text-[color:var(--muted)]">{result.reason}</span>
          </div>

          <dl className="grid gap-1 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[color:var(--muted)]">E-post</dt>
              <dd>{result.user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-[color:var(--muted)]">User ID</dt>
              <dd className="font-mono text-xs">{result.user.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-[color:var(--muted)]">Aktiv</dt>
              <dd>{result.user.isActive ? "ja" : "nei"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[color:var(--muted)]">Kun dørvakt</dt>
              <dd>{result.user.doorStaffOnly ? "ja" : "nei"}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
              Org-medlemskap
            </h3>
            {result.memberships.length === 0 ? (
              <p className="mt-1 text-[color:var(--muted)]">Ingen</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {result.memberships.map((m) => (
                  <li key={m.organizationId}>
                    {m.organizationName} · {orgRoleLabel(m.role)} ·{" "}
                    {m.membershipActive ? "aktiv" : "inaktiv"} · scan{" "}
                    {m.canScanOrg ? "ja" : "nei"}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
              EventAssignment
            </h3>
            {result.eventAssignments.length === 0 ? (
              <p className="mt-1 text-[color:var(--muted)]">Ingen tildelinger</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {result.eventAssignments.map((a) => (
                  <li
                    key={a.eventId}
                    className="rounded-md bg-[color:var(--surface-low)] px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.eventName}</span>
                      <Badge variant="muted">{a.eventStatus}</Badge>
                      <Badge
                        variant={
                          a.scannerAccess === "allowed" ? "success" : "warning"
                        }
                      >
                        {a.scannerAccess}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                      {a.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
              Synlige på /scan ({result.scannerVisibleEvents.length})
            </h3>
            {result.scannerVisibleEvents.length === 0 ? (
              <p className="mt-1 text-[color:var(--muted)]">Ingen</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {result.scannerVisibleEvents.map((e) => (
                  <li key={e.id}>
                    {e.name} · {e.status}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-[color:var(--muted)]">{result.notes.dualDomain}</p>
        </div>
      ) : null}
    </section>
  );
}
