"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export type OwnershipOrgOption = {
  id: string;
  name: string;
  legalName: string | null;
  isActive: boolean;
};

const ORGANIZER_CONFIRM =
  "Dette flytter arrangementet til en annen organisasjon. Eksisterende billetter og ordre beholdes.";

export function EventOwnershipForm({
  eventId,
  organizationId,
  sellerOrganizationId,
  organizations,
}: {
  eventId: string;
  organizationId: string;
  sellerOrganizationId: string;
  organizations: OwnershipOrgOption[];
}) {
  const router = useRouter();
  const activeOrgs = organizations.filter((o) => o.isActive);
  const [organizerId, setOrganizerId] = useState(organizationId);
  const [sellerId, setSellerId] = useState(sellerOrganizationId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = organizerId !== organizationId || sellerId !== sellerOrganizationId;
  const organizerChanged = organizerId !== organizationId;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (organizerChanged && !window.confirm(ORGANIZER_CONFIRM)) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizerId,
          sellerOrganizationId: sellerId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setMsg(body?.error?.message ?? "Kunne ikke lagre eierskap");
        return;
      }
      setMsg("Eierskap lagret");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function orgLabel(o: OwnershipOrgOption) {
    return o.legalName && o.legalName !== o.name ? `${o.name} (${o.legalName})` : o.name;
  }

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm"
      data-testid="event-ownership-form"
    >
      <h2 className="font-medium">Organisasjon & juridisk selger</h2>
      <p className="text-xs text-[color:var(--muted)]">
        Kun SUPER_ADMIN. Flytting endrer arrangementets organisasjon fremover — historiske ordre
        og billetter beholdes.
      </p>

      <label className="block space-y-1">
        <span className="text-[color:var(--muted)]">Organisator:</span>
        <select
          className="w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
          value={organizerId}
          onChange={(e) => setOrganizerId(e.target.value)}
          data-testid="ownership-organizer"
          required
        >
          {activeOrgs.map((o) => (
            <option key={o.id} value={o.id}>
              {orgLabel(o)}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-[color:var(--muted)]">Juridisk selger:</span>
        <select
          className="w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          data-testid="ownership-seller"
          required
        >
          {activeOrgs.map((o) => (
            <option key={o.id} value={o.id}>
              {orgLabel(o)}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" disabled={busy || !dirty}>
        Lagre eierskap
      </Button>
      {msg ? <p className="text-xs text-[color:var(--muted)]">{msg}</p> : null}
    </form>
  );
}
