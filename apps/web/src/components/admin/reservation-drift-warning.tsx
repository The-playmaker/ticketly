import Link from "next/link";

export type ReservationDriftTypeRow = {
  ticketTypeId: string;
  name: string;
  storedQuantityReserved: number;
  calculatedActiveReserved: number;
  delta: number;
  expiredActiveCount: number;
};

/**
 * Warn organizers / SUPER_ADMIN when TicketType.quantityReserved diverges
 * from SUM(ACTIVE keeper reservations).
 */
export function ReservationDriftWarning({
  eventId,
  detected,
  repaired,
  expiredCount,
  types,
  showRepairLink,
}: {
  eventId: string;
  detected: boolean;
  repaired?: boolean;
  expiredCount?: number;
  types: ReservationDriftTypeRow[];
  /** SUPER_ADMIN settings page has the repair form */
  showRepairLink?: boolean;
}) {
  if (!detected || types.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-700/40 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <p className="font-medium">Reservasjons-inventaret var ute av synk</p>
      <p className="mt-1 text-xs text-amber-900/80">
        Lagret <code className="text-[11px]">quantityReserved</code> stemte ikke med aktive
        reservasjoner
        {repaired ? " — tellerne er auto-reparert ved denne lesingen" : ""}.
        {expiredCount && expiredCount > 0
          ? ` ${expiredCount} utløpt(e) ACTIVE-reservasjon(er) ble frigjort.`
          : null}
      </p>
      <ul className="mt-3 space-y-1 text-xs">
        {types.map((t) => (
          <li key={t.ticketTypeId}>
            <span className="font-medium">{t.name}</span>: lagret {t.storedQuantityReserved} ·
            beregnet {t.calculatedActiveReserved} · delta{" "}
            {t.delta > 0 ? `+${t.delta}` : t.delta}
            {t.expiredActiveCount > 0 ? ` · utløper ${t.expiredActiveCount}` : ""}
          </li>
        ))}
      </ul>
      {showRepairLink ? (
        <p className="mt-3 text-xs">
          Manuell nødverktøy:{" "}
          <Link
            href={`/admin/events/${eventId}/settings`}
            className="underline underline-offset-2"
          >
            Innstillinger → Reparere reservasjoner
          </Link>
        </p>
      ) : null}
    </div>
  );
}
