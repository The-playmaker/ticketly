"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Entry = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  requestedQuantity: number;
  status: string;
  createdAt: string;
  ticketType?: { id: string; name: string } | null;
};

export function WaitlistPanel({
  eventId,
  initialEntries,
  waitingCount,
}: {
  eventId: string;
  initialEntries: Entry[];
  waitingCount: number;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [waiting, setWaiting] = useState(waitingCount);
  const [custom, setCustom] = useState("10");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/admin/events/${eventId}/waitlist`);
    if (!res.ok) return;
    const data = (await res.json()) as { entries: Entry[]; waiting: number };
    setEntries(
      data.entries.map((e) => ({
        ...e,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : String(e.createdAt),
      }))
    );
    setWaiting(data.waiting);
  }

  async function invite(count: number) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", count }),
      });
      if (!res.ok) {
        setMsg("Kunne ikke invitere");
        return;
      }
      const data = (await res.json()) as { invited: number };
      setMsg(`Inviterte ${data.invited} personer`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[color:var(--muted)]">
          <span className="font-semibold text-foreground">{waiting}</span> venter
        </p>
        <Button type="button" disabled={busy || waiting === 0} onClick={() => void invite(10)}>
          Inviter neste 10
        </Button>
        <Button type="button" disabled={busy || waiting === 0} onClick={() => void invite(25)}>
          Inviter neste 25
        </Button>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="w-20 rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-2 py-1.5 text-sm"
          />
          <Button
            type="button"
            disabled={busy || waiting === 0}
            onClick={() => void invite(Number(custom) || 1)}
          >
            Inviter
          </Button>
        </div>
      </div>
      {msg ? <p className="text-sm text-[color:var(--muted)]">{msg}</p> : null}

      <div className="overflow-hidden rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">E-post</th>
              <th className="px-4 py-3">Navn</th>
              <th className="px-4 py-3">Antall</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Registrert</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[color:var(--muted)]">
                  Ingen på ventelisten
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-[color:var(--outline)]/20">
                  <td className="px-4 py-3">{e.email}</td>
                  <td className="px-4 py-3">{e.name ?? "—"}</td>
                  <td className="px-4 py-3">{e.requestedQuantity}</td>
                  <td className="px-4 py-3">{e.ticketType?.name ?? "Alle"}</td>
                  <td className="px-4 py-3">{e.status}</td>
                  <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                    {new Date(e.createdAt).toLocaleString("nb-NO")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
