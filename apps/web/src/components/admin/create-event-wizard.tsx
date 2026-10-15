"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  organizationId: string;
  defaultServiceFee: number;
  currency: string;
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateEventWizard({ organizationId, defaultServiceFee, currency }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(20, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 0, 0, 0);

  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "Concert",
    coverImageUrl: "",
    city: "Oslo",
    address: "",
    ageLimit: 18,
    capacity: 500,
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    ticketName: "Ordinær",
    priceKr: 249,
    quantityTotal: 500,
    quantityReleased: 50,
    maxPerOrder: 6,
    serviceFeeKr: defaultServiceFee / 100,
    publish: true,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const startsAt = new Date(form.startsAt).toISOString();
      const endsAt = new Date(form.endsAt).toISOString();
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: form.name,
          description: form.description,
          category: form.category,
          coverImageUrl: form.coverImageUrl || undefined,
          city: form.city,
          address: form.address || undefined,
          ageLimit: form.ageLimit,
          capacity: form.capacity,
          startsAt,
          endsAt,
          serviceFee: Math.round(form.serviceFeeKr * 100),
          currency,
          publish: form.publish,
          ticket: {
            name: form.ticketName,
            price: Math.round(form.priceKr * 100),
            quantityTotal: form.quantityTotal,
            quantityReleased: form.quantityReleased,
            maxPerOrder: form.maxPerOrder,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Kunne ikke opprette");
      }
      router.push(`/admin/events/${data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feil");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex gap-2 text-xs font-medium text-zinc-500">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStep(n)}
            className={`rounded-full px-3 py-1 ${step === n ? "bg-zinc-900 text-white" : "bg-zinc-100"}`}
          >
            Steg {n}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Arrangement</h2>
          <div>
            <Label htmlFor="name">Navn</Label>
            <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Friday Night" />
          </div>
          <div>
            <Label htmlFor="desc">Beskrivelse</Label>
            <textarea
              id="desc"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              rows={4}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cover">Cover-bilde URL (valgfritt)</Label>
            <Input
              id="cover"
              value={form.coverImageUrl}
              onChange={(e) => set("coverImageUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <Button type="button" onClick={() => setStep(2)} disabled={!form.name.trim()}>
            Neste
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Tid & sted</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="starts">Start</Label>
              <Input id="starts" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ends">Slutt</Label>
              <Input id="ends" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="city">By</Label>
              <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="age">Aldersgrense</Label>
              <Input id="age" type="number" value={form.ageLimit} onChange={(e) => set("ageLimit", Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="addr">Adresse</Label>
            <Input id="addr" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cap">Total kapasitet</Label>
            <Input id="cap" type="number" value={form.capacity} onChange={(e) => set("capacity", Number(e.target.value))} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Tilbake
            </Button>
            <Button type="button" onClick={() => setStep(3)}>
              Neste
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Billetter</h2>
          <p className="text-sm text-zinc-500">
            Skill mellom total kapasitet og første release. Du kan frigjøre mer senere.
          </p>
          <div>
            <Label htmlFor="tt">Billettnavn</Label>
            <Input id="tt" value={form.ticketName} onChange={(e) => set("ticketName", e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="price">Pris (kr)</Label>
              <Input id="price" type="number" value={form.priceKr} onChange={(e) => set("priceKr", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="max">Maks per ordre</Label>
              <Input id="max" type="number" value={form.maxPerOrder} onChange={(e) => set("maxPerOrder", Number(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="total">Total allokering</Label>
              <Input
                id="total"
                type="number"
                value={form.quantityTotal}
                onChange={(e) => set("quantityTotal", Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rel">Første release</Label>
              <Input
                id="rel"
                type="number"
                value={form.quantityReleased}
                onChange={(e) => set("quantityReleased", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep(2)}>
              Tilbake
            </Button>
            <Button type="button" onClick={() => setStep(4)}>
              Neste
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Checkout & publiser</h2>
          <div>
            <Label htmlFor="fee">Service fee (kr per billett)</Label>
            <Input
              id="fee"
              type="number"
              value={form.serviceFeeKr}
              onChange={(e) => set("serviceFeeKr", Number(e.target.value))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(e) => set("publish", e.target.checked)}
            />
            Publiser umiddelbart (åpne for salg)
          </label>
          <div className="rounded-lg bg-zinc-50 p-4 text-sm">
            <p className="font-medium">{form.name || "—"}</p>
            <p className="text-zinc-600">
              {form.ticketName}: {form.priceKr} kr · Release {form.quantityReleased} / {form.quantityTotal}
            </p>
            <p className="text-zinc-600">Kapasitet {form.capacity} · {form.city}</p>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep(3)}>
              Tilbake
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !form.name.trim()}>
              {busy ? "Oppretter…" : form.publish ? "Opprett & publiser" : "Lagre som utkast"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
