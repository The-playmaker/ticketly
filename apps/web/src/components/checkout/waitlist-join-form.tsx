"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WaitlistJoinForm({
  eventId,
  ticketTypeId,
}: {
  eventId: string;
  ticketTypeId?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [quantity, setQuantity] = useState("2");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          name: name.trim() || undefined,
          email,
          phone: phone.trim() || undefined,
          requestedQuantity: Number(quantity) || 1,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Kunne ikke melde på venteliste");
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-4 rounded-lg border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] p-4 text-sm text-zinc-200">
        Du står nå på ventelisten. Vi gir beskjed på e-post hvis billetter blir tilgjengelige.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-lg border border-[color:var(--outline)]/40 p-4">
      <p className="text-sm font-medium text-zinc-100">Meld meg på venteliste</p>
      <Input
        placeholder="Navn"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      <Input
        type="email"
        placeholder="E-post"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <Input
        type="tel"
        placeholder="Telefon (valgfritt)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoComplete="tel"
      />
      <Input
        type="number"
        min={1}
        max={20}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        aria-label="Ønsket antall"
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <Button type="submit" disabled={busy || !email.trim()}>
        Meld meg på venteliste
      </Button>
    </form>
  );
}
