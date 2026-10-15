"use client";

import { useEffect, useState } from "react";

export function ReservationCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setRemaining(msLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining <= 0) {
    return (
      <p className="mt-3 text-xs text-amber-400">
        Reservasjonen kan være utløpt — fullfør betaling snarest. Betalt ordre beholdes.
      </p>
    );
  }

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);

  return (
    <p className="mt-3 text-xs text-zinc-400">
      Reservert{" "}
      <span className="font-mono text-amber-300">
        {mins}:{secs.toString().padStart(2, "0")}
      </span>
    </p>
  );
}

function msLeft(expiresAt: string) {
  return new Date(expiresAt).getTime() - Date.now();
}
