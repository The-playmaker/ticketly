"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDateTime } from "@/lib/time";
import { buildQrPayload } from "@/lib/tickets/token";
import { getTicketStatusPresentation } from "@/lib/tickets/ticket-status";

export type TicketQrCardTicket = {
  publicId: string;
  secureToken: string;
  accessToken?: string;
  holderName: string | null;
  status: string;
  ticketTypeName: string;
};

export type TicketQrCardEvent = {
  name: string;
  startsAt: string;
  timezone: string;
  venue: string;
  ageLimit?: number | null;
};

type Props = {
  ticket: TicketQrCardTicket;
  event: TicketQrCardEvent;
  orderNumber: string;
  /** When true, hide the per-card PDF button (carousel owns the download CTA). */
  hidePdfButton?: boolean;
};

export function TicketQrCard({ ticket, event, orderNumber, hidePdfButton }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const qrValue = buildQrPayload(ticket.secureToken);
  const status = getTicketStatusPresentation(ticket.status);
  const pdfHref = `/api/tickets/${ticket.publicId}/pdf${
    ticket.accessToken ? `?t=${encodeURIComponent(ticket.accessToken)}` : ""
  }`;

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(qrValue, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#09090b", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qrValue]);

  return (
    <article className="overflow-hidden rounded-2xl border border-[color:var(--outline)]/30 bg-gradient-to-b from-zinc-900 to-zinc-950">
      <div className="border-b border-[color:var(--outline)]/30 bg-zinc-900/80 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-xl text-white">{event.name}</p>
            <p className="text-sm text-zinc-400">
              {formatEventDateTime(event.startsAt, event.timezone)}
            </p>
            <p className="text-sm text-[color:var(--muted)]">{event.venue}</p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </div>

      <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start sm:gap-6">
        <div className="shrink-0 rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          {status.qrDisabled ? (
            <div
              className="flex h-56 w-56 flex-col items-center justify-center gap-2 p-3 text-center"
              role="status"
            >
              <span className="text-sm font-semibold text-zinc-800">{status.label}</span>
              <span className="text-xs leading-snug text-zinc-600">{status.description}</span>
            </div>
          ) : dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={`QR for billett ${ticket.publicId}`}
              className="h-56 w-56"
              width={224}
              height={224}
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center text-xs text-zinc-500">
              Laster QR…
            </div>
          )}
        </div>

        <div className="w-full min-w-0 flex-1 space-y-3 text-sm">
          {!status.qrDisabled ? (
            <p className="text-xs text-[color:var(--accent-soft)]">{status.description}</p>
          ) : null}
          <p>
            <span className="text-[color:var(--muted)]">Billettype</span>
            <br />
            <span className="font-medium text-white">{ticket.ticketTypeName}</span>
          </p>
          <p>
            <span className="text-[color:var(--muted)]">Navn</span>
            <br />
            <span className="font-medium text-white">{ticket.holderName ?? "—"}</span>
          </p>
          <p>
            <span className="text-[color:var(--muted)]">Dato</span>
            <br />
            <span className="font-medium text-white">
              {formatEventDateTime(event.startsAt, event.timezone)}
            </span>
          </p>
          <p>
            <span className="text-[color:var(--muted)]">Sted</span>
            <br />
            <span className="font-medium text-white">{event.venue || "—"}</span>
          </p>
          {event.ageLimit != null ? (
            <p>
              <span className="text-[color:var(--muted)]">Alderskrav</span>
              <br />
              <span className="font-medium text-white">
                {event.ageLimit}+ · Gyldig legitimasjon kreves
              </span>
            </p>
          ) : null}
          <p>
            <span className="text-[color:var(--muted)]">Ordre</span>
            <br />
            <span className="font-mono text-xs text-zinc-300">{orderNumber}</span>
          </p>
          <p>
            <span className="text-[color:var(--muted)]">Billett-ID</span>
            <br />
            <span className="font-mono text-xs text-zinc-300">{ticket.publicId}</span>
          </p>
          {!hidePdfButton ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild size="sm" variant="secondary">
                <Link href={pdfHref} prefetch={false} target="_blank" rel="noopener noreferrer">
                  Last ned PDF
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
