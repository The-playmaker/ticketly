"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDateTime } from "@/lib/time";
import { buildQrPayload } from "@/lib/tickets/token";

type Props = {
  ticket: {
    publicId: string;
    secureToken: string;
    holderName: string | null;
    status: string;
    ticketTypeName: string;
  };
  event: {
    name: string;
    startsAt: string;
    timezone: string;
    venue: string;
  };
  orderNumber: string;
};

export function TicketQrCard({ ticket, event, orderNumber }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const qrValue = buildQrPayload(ticket.secureToken);

  useEffect(() => {
    void QRCode.toDataURL(qrValue, {
      width: 280,
      margin: 2,
      color: { dark: "#09090b", light: "#ffffff" },
    }).then(setDataUrl);
  }, [qrValue]);

  const statusVariant =
    ticket.status === "VALID"
      ? "success"
      : ticket.status === "CHECKED_IN"
        ? "muted"
        : "danger";

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/80 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl text-white">{event.name}</p>
            <p className="text-sm text-zinc-400">
              {formatEventDateTime(event.startsAt, event.timezone)}
            </p>
            <p className="text-sm text-zinc-500">{event.venue}</p>
          </div>
          <Badge variant={statusVariant}>{ticket.status}</Badge>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto rounded-xl bg-white p-3">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt={`QR for ${ticket.publicId}`} className="h-40 w-40" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center text-xs text-zinc-500">
              Laster QR…
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Billettype</span>
            <br />
            <span className="font-medium">{ticket.ticketTypeName}</span>
          </p>
          <p>
            <span className="text-zinc-500">Navn</span>
            <br />
            <span className="font-medium">{ticket.holderName}</span>
          </p>
          <p>
            <span className="text-zinc-500">Ordre</span>
            <br />
            <span className="font-mono text-xs">{orderNumber}</span>
          </p>
          <p>
            <span className="text-zinc-500">Billettnummer</span>
            <br />
            <span className="font-mono text-xs">{ticket.publicId}</span>
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.open(`/api/tickets/${ticket.publicId}/pdf`, "_blank")}
            >
              Last ned PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Apple/Google Wallet kan kobles på senere via WalletPassProvider"
              disabled
            >
              Add to wallet
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
