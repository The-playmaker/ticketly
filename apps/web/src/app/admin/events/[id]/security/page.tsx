import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireEventAccess } from "@/lib/admin/org-access";
import { FraudDiagnosticsService } from "@/services/fraud-diagnostics-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { params: Promise<{ id: string }> };

export default async function EventSecurityPage({ params }: Props) {
  const { id } = await params;
  await auth();
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const diag = await FraudDiagnosticsService.forEvent(id, 24);

  const cards = [
    { label: "Ugyldige skann (24t)", value: diag.summary.invalidScans },
    { label: "Duplikatforsøk", value: diag.summary.duplicateEntryAttempts },
    { label: "Feil arrangement", value: diag.summary.wrongEvent },
    { label: "Deaktivert scanner", value: diag.summary.revokedDeviceAttempts },
    { label: "Manuelle / override", value: diag.summary.manualOverrides },
    { label: "Offline-konflikter", value: diag.summary.offlineSyncConflicts },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Sikkerhet & anti-svindel</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Interne diagnostikk for {event.name}. Vises ikke for kunder. Ingen QR-tokens eller
          tilgangslenker eksponeres her.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          QR-modus: {event.qrMode ?? "STATIC_QR"} · Dynamisk QR prod-default er av
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="border-zinc-200 bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums text-zinc-900">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-800">Siste duplikatforsøk</h3>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
          {diag.recentDuplicateAttempts.length === 0 ? (
            <li className="px-3 py-4 text-zinc-500">Ingen i vinduet</li>
          ) : (
            diag.recentDuplicateAttempts.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2">
                <span className="font-mono text-xs">{r.publicId ?? "—"}</span>
                <span className="text-zinc-500">{new Date(r.at).toLocaleString("nb-NO")}</span>
                <span className="text-zinc-500">enhet: {r.deviceId ?? "—"}</span>
                <span className="text-zinc-500">av: {r.staffName ?? "—"}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-800">Force overrides</h3>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
          {diag.recentForceOverrides.length === 0 ? (
            <li className="px-3 py-4 text-zinc-500">Ingen i vinduet</li>
          ) : (
            diag.recentForceOverrides.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <span className="text-zinc-500">{new Date(r.at).toLocaleString("nb-NO")}</span>
                {" · "}
                <span className="font-mono text-xs">{r.ticketId ?? "—"}</span>
                {r.reason ? <span className="text-zinc-600"> — {r.reason}</span> : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-800">Deaktiverte enheter med aktivitet</h3>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
          {diag.revokedDevicesActive.length === 0 ? (
            <li className="px-3 py-4 text-zinc-500">Ingen</li>
          ) : (
            diag.revokedDevicesActive.map((d) => (
              <li key={d.id} className="px-3 py-2">
                {d.deviceName}{" "}
                <span className="text-zinc-500">
                  (revoked {d.revokedAt ? new Date(d.revokedAt).toLocaleString("nb-NO") : "—"})
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
