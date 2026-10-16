"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function EventParitySettingsForm({
  eventId,
  waitlistEnabled,
  waitlistOnReleaseSoldOut,
  reminder24hEnabled,
  reminder3hEnabled,
}: {
  eventId: string;
  waitlistEnabled: boolean;
  waitlistOnReleaseSoldOut: boolean;
  reminder24hEnabled: boolean;
  reminder3hEnabled: boolean;
}) {
  const [waitlist, setWaitlist] = useState(waitlistEnabled);
  const [waitlistRelease, setWaitlistRelease] = useState(waitlistOnReleaseSoldOut);
  const [r24, setR24] = useState(reminder24hEnabled);
  const [r3, setR3] = useState(reminder3hEnabled);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waitlistEnabled: waitlist,
          waitlistOnReleaseSoldOut: waitlistRelease,
          reminder24hEnabled: r24,
          reminder3hEnabled: r3,
        }),
      });
      if (!res.ok) {
        setMsg("Kunne ikke lagre");
        return;
      }
      setMsg("Lagret");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm"
    >
      <h2 className="font-medium">Venteliste & påminnelser</h2>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={waitlist} onChange={(e) => setWaitlist(e.target.checked)} />
        Venteliste når utsolgt
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={waitlistRelease}
          onChange={(e) => setWaitlistRelease(e.target.checked)}
        />
        Venteliste også når nåværende release er utsolgt
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={r24} onChange={(e) => setR24(e.target.checked)} />
        Påminnelse 24 timer før
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={r3} onChange={(e) => setR3(e.target.checked)} />
        Påminnelse 3 timer før dører (krever døråpningstid)
      </label>

      <Button type="submit" disabled={busy}>
        Lagre
      </Button>
      {msg ? <p className="text-xs text-[color:var(--muted)]">{msg}</p> : null}
    </form>
  );
}
