"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CoverImageUploader } from "@/components/admin/cover-image-uploader";
import {
  EventOwnershipForm,
  type OwnershipOrgOption,
} from "@/components/admin/event-ownership-form";

export type EditTicketType = {
  id?: string;
  name: string;
  description: string;
  priceKr: number;
  quantityTotal: number;
  quantityReleased: number;
  quantitySold: number;
  quantityReserved: number;
  maxPerOrder: number;
  minPerOrder: number;
  salesStartAt: string;
  salesEndAt: string;
  isVisible: boolean;
  sortOrder: number;
  _delete?: boolean;
};

export type EditEventInitial = {
  id: string;
  name: string;
  description: string;
  shortDescription: string;
  category: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  doorsOpenAt: string;
  ageLimit: number | "";
  capacity: number;
  status: string;
  visibility: string;
  salesStartAt: string;
  salesEndAt: string;
  coverImageUrl: string | null;
  updatedAt: string;
  venueName: string;
  organizationId: string;
  sellerOrganizationId: string;
  ticketTypes: EditTicketType[];
};

const STATUS_OPTIONS = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHED",
  "PAUSED",
  "SOLD_OUT",
  "CANCELLED",
  "COMPLETED",
] as const;

const VISIBILITY_OPTIONS = ["PUBLIC", "UNLISTED", "HIDDEN"] as const;

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function EditEventForm({
  initial,
  isPlatformAdmin,
  organizations,
}: {
  initial: EditEventInitial;
  isPlatformAdmin: boolean;
  organizations: OwnershipOrgOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [shortDescription, setShortDescription] = useState(initial.shortDescription);
  const [category, setCategory] = useState(initial.category);
  const [address, setAddress] = useState(initial.address);
  const [postalCode, setPostalCode] = useState(initial.postalCode);
  const [city, setCity] = useState(initial.city);
  const [venueName, setVenueName] = useState(initial.venueName);
  const [startsAt, setStartsAt] = useState(toLocalInput(initial.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial.endsAt));
  const [doorsOpenAt, setDoorsOpenAt] = useState(toLocalInput(initial.doorsOpenAt));
  const [ageLimit, setAgeLimit] = useState<number | "">(initial.ageLimit);
  const [capacity, setCapacity] = useState(initial.capacity);
  const [status, setStatus] = useState(initial.status);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [salesStartAt, setSalesStartAt] = useState(toLocalInput(initial.salesStartAt));
  const [salesEndAt, setSalesEndAt] = useState(toLocalInput(initial.salesEndAt));
  const [coverImageUrl, setCoverImageUrl] = useState(initial.coverImageUrl);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [ticketTypes, setTicketTypes] = useState<EditTicketType[]>(() =>
    initial.ticketTypes.map((t) => ({
      ...t,
      salesStartAt: toLocalInput(t.salesStartAt),
      salesEndAt: toLocalInput(t.salesEndAt),
    }))
  );

  const visibleTickets = useMemo(
    () => ticketTypes.filter((t) => !t._delete),
    [ticketTypes]
  );

  function updateTicket(index: number, patch: Partial<EditTicketType>) {
    setTicketTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function addTicketType() {
    setTicketTypes((prev) => [
      ...prev,
      {
        name: "Ny billettype",
        description: "",
        priceKr: 0,
        quantityTotal: 0,
        quantityReleased: 0,
        quantitySold: 0,
        quantityReserved: 0,
        maxPerOrder: 6,
        minPerOrder: 1,
        salesStartAt: "",
        salesEndAt: "",
        isVisible: true,
        sortOrder: prev.length,
      },
    ]);
  }

  function markDeleteTicket(index: number) {
    setTicketTypes((prev) => {
      const t = prev[index];
      if (!t) return prev;
      if (!t.id) return prev.filter((_, i) => i !== index);
      if (t.quantitySold > 0 || t.quantityReserved > 0) {
        setError("Kan ikke slette billettype med solgte eller reserverte billetter");
        return prev;
      }
      return prev.map((row, i) => (i === index ? { ...row, _delete: true } : row));
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const startsIso = fromLocalInput(startsAt);
      const endsIso = fromLocalInput(endsAt);
      if (!startsIso || !endsIso) {
        throw new Error("Start- og sluttid er påkrevd");
      }

      const res = await fetch(`/api/admin/events/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          shortDescription: shortDescription || null,
          category: category || null,
          address: address || null,
          postalCode: postalCode || null,
          city: city || null,
          venueName: venueName || null,
          startsAt: startsIso,
          endsAt: endsIso,
          doorsOpenAt: fromLocalInput(doorsOpenAt),
          ageLimit: ageLimit === "" ? null : Number(ageLimit),
          capacity: Number(capacity),
          status,
          visibility,
          salesStartAt: fromLocalInput(salesStartAt),
          salesEndAt: fromLocalInput(salesEndAt),
          ticketTypes: ticketTypes.map((t, i) => ({
            id: t.id,
            name: t.name,
            description: t.description || null,
            price: Math.round(t.priceKr * 100),
            quantityTotal: t.quantityTotal,
            quantityReleased: t.quantityReleased,
            maxPerOrder: t.maxPerOrder,
            minPerOrder: t.minPerOrder,
            salesStartAt: fromLocalInput(t.salesStartAt),
            salesEndAt: fromLocalInput(t.salesEndAt),
            isVisible: t.isVisible,
            sortOrder: t.sortOrder ?? i,
            _delete: t._delete ?? false,
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        event?: { updatedAt?: string; coverImageUrl?: string | null };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Kunne ikke lagre arrangementet");
      }
      if (data?.event?.updatedAt) setUpdatedAt(data.event.updatedAt);
      setMsg("Arrangement lagret");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lagring feilet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="edit-event-form">
      <CoverImageUploader
        eventId={initial.id}
        coverImageUrl={coverImageUrl}
        updatedAt={updatedAt}
        onChange={(url, nextUpdatedAt) => {
          setCoverImageUrl(url);
          if (nextUpdatedAt) setUpdatedAt(nextUpdatedAt);
        }}
      />

      <form
        onSubmit={(e) => void save(e)}
        className="space-y-6 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5"
      >
        <section className="space-y-4">
          <h2 className="font-medium">Arrangement</h2>
          <div>
            <Label htmlFor="ev-name">Tittel</Label>
            <Input
              id="ev-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div>
            <Label htmlFor="ev-short">Kort beskrivelse</Label>
            <Input
              id="ev-short"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              maxLength={300}
            />
          </div>
          <div>
            <Label htmlFor="ev-desc">Beskrivelse</Label>
            <textarea
              id="ev-desc"
              className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ev-cat">Kategori</Label>
            <Input id="ev-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </section>

        <section className="space-y-4 border-t border-[color:var(--outline)]/25 pt-5">
          <h2 className="font-medium">Tid & sted</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-starts">Start</Label>
              <Input
                id="ev-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="ev-ends">Slutt</Label>
              <Input
                id="ev-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="ev-doors">Dører</Label>
              <Input
                id="ev-doors"
                type="datetime-local"
                value={doorsOpenAt}
                onChange={(e) => setDoorsOpenAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ev-age">Aldersgrense</Label>
              <Input
                id="ev-age"
                type="number"
                min={0}
                max={99}
                value={ageLimit}
                onChange={(e) =>
                  setAgeLimit(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-venue">Venue</Label>
              <Input
                id="ev-venue"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="Stedsnavn"
              />
            </div>
            <div>
              <Label htmlFor="ev-city">By</Label>
              <Input id="ev-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ev-addr">Adresse</Label>
              <Input id="ev-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ev-postal">Postnummer</Label>
              <Input
                id="ev-postal"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ev-cap">Kapasitet</Label>
              <Input
                id="ev-cap"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-[color:var(--outline)]/25 pt-5">
          <h2 className="font-medium">Status & synlighet</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-status">Status</Label>
              <select
                id="ev-status"
                className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ev-vis">Synlighet</Label>
              <select
                id="ev-vis"
                className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                {VISIBILITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ev-sales-start">Salgsstart</Label>
              <Input
                id="ev-sales-start"
                type="datetime-local"
                value={salesStartAt}
                onChange={(e) => setSalesStartAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ev-sales-end">Salgsstopp</Label>
              <Input
                id="ev-sales-end"
                type="datetime-local"
                value={salesEndAt}
                onChange={(e) => setSalesEndAt(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-[color:var(--outline)]/25 pt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Billetter</h2>
            <Button type="button" variant="secondary" onClick={addTicketType}>
              Legg til type
            </Button>
          </div>
          <p className="text-xs text-[color:var(--muted)]">
            Ordrer, betalinger og utstedte billetter beholdes. Total kan ikke settes under solgt.
          </p>
          <ul className="space-y-4">
            {ticketTypes.map((t, index) => {
              if (t._delete) return null;
              return (
                <li
                  key={t.id ?? `new-${index}`}
                  className="space-y-3 rounded-lg border border-[color:var(--outline)]/25 p-4"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Navn</Label>
                      <Input
                        value={t.name}
                        onChange={(e) => updateTicket(index, { name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label>Pris (kr)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={t.priceKr}
                        onChange={(e) =>
                          updateTicket(index, { priceKr: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label>Total</Label>
                      <Input
                        type="number"
                        min={t.quantitySold}
                        value={t.quantityTotal}
                        onChange={(e) =>
                          updateTicket(index, { quantityTotal: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label>Release</Label>
                      <Input
                        type="number"
                        min={t.quantitySold + t.quantityReserved}
                        value={t.quantityReleased}
                        onChange={(e) =>
                          updateTicket(index, { quantityReleased: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label>Salgsstart</Label>
                      <Input
                        type="datetime-local"
                        value={t.salesStartAt}
                        onChange={(e) => updateTicket(index, { salesStartAt: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Salgsstopp</Label>
                      <Input
                        type="datetime-local"
                        value={t.salesEndAt}
                        onChange={(e) => updateTicket(index, { salesEndAt: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Maks per ordre</Label>
                      <Input
                        type="number"
                        min={1}
                        value={t.maxPerOrder}
                        onChange={(e) =>
                          updateTicket(index, { maxPerOrder: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="flex items-end gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={t.isVisible}
                          onChange={(e) =>
                            updateTicket(index, { isVisible: e.target.checked })
                          }
                        />
                        Synlig
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => markDeleteTicket(index)}
                      >
                        Slett
                      </Button>
                    </div>
                  </div>
                  {t.id ? (
                    <p className="text-xs text-[color:var(--muted)]">
                      Solgt {t.quantitySold} · Reservert {t.quantityReserved}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {visibleTickets.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">Ingen billettyper</p>
          ) : null}
        </section>

        {error ? (
          <p className="text-sm text-[color:var(--destructive)]" role="alert">
            {error}
          </p>
        ) : null}
        {msg ? <p className="text-xs text-[color:var(--muted)]">{msg}</p> : null}

        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Lagrer…" : "Lagre arrangement"}
        </Button>
      </form>

      {isPlatformAdmin ? (
        <EventOwnershipForm
          eventId={initial.id}
          organizationId={initial.organizationId}
          sellerOrganizationId={initial.sellerOrganizationId}
          organizations={organizations}
        />
      ) : null}
    </div>
  );
}
