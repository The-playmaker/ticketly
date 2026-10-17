"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VatRegistrationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const VAT_OPTIONS: VatRegistrationStatus[] = [
  "UNKNOWN",
  "REGISTERED",
  "NOT_REGISTERED",
  "EXEMPT",
];

export function CreateOrganizationForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    organizationNumber: "",
    legalAddress: "",
    legalPostalCode: "",
    legalCity: "",
    legalCountry: "NO",
    customerServiceEmail: "",
    customerServicePhone: "",
    contactEmail: "",
    website: "",
    vatRegistrationStatus: "UNKNOWN" as VatRegistrationStatus,
    refundPolicyText: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        displayName: form.name.trim(),
        legalName: form.legalName.trim(),
        organizationNumber: form.organizationNumber.trim(),
        legalAddress: form.legalAddress.trim(),
        legalPostalCode: form.legalPostalCode.trim(),
        legalCity: form.legalCity.trim(),
        legalCountry: form.legalCountry.trim().toUpperCase(),
        customerServiceEmail: form.customerServiceEmail.trim(),
        customerServicePhone: form.customerServicePhone.trim(),
        contactEmail: form.contactEmail.trim(),
        website: form.website.trim() || undefined,
        vatRegistrationStatus: form.vatRegistrationStatus,
        refundPolicyText: form.refundPolicyText.trim(),
      }),
    });

    if (!res.ok) {
      setBusy(false);
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Opprettelse feilet");
      return;
    }

    // Full document navigation reloads JWT (memberships refreshed on every jwt callback)
    // so /admin/settings immediately resolves the new org and team works.
    window.location.assign("/admin/settings");
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm"
    >
      <h2 className="font-medium">Ny organisasjon</h2>
      <p className="text-xs text-[color:var(--muted)]">
        Du blir automatisk lagt til som organisasjonsadmin (ORGANIZER_ADMIN).
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Visningsnavn</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <Label>Juridisk navn</Label>
          <Input
            value={form.legalName}
            onChange={(e) => set("legalName", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Organisasjonsnummer</Label>
          <Input
            value={form.organizationNumber}
            onChange={(e) => set("organizationNumber", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>VAT-registreringsstatus</Label>
          <select
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-low)] px-3 py-2"
            value={form.vatRegistrationStatus}
            onChange={(e) =>
              set("vatRegistrationStatus", e.target.value as VatRegistrationStatus)
            }
            required
          >
            {VAT_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label>Juridisk adresse</Label>
          <Input
            value={form.legalAddress}
            onChange={(e) => set("legalAddress", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Postnummer</Label>
          <Input
            value={form.legalPostalCode}
            onChange={(e) => set("legalPostalCode", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>By</Label>
          <Input
            value={form.legalCity}
            onChange={(e) => set("legalCity", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Land</Label>
          <Input
            value={form.legalCountry}
            onChange={(e) => set("legalCountry", e.target.value)}
            required
            maxLength={2}
          />
        </div>
        <div>
          <Label>Nettsted (valgfritt)</Label>
          <Input
            type="url"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="https://"
          />
        </div>
        <div>
          <Label>Kundeservice-e-post</Label>
          <Input
            type="email"
            value={form.customerServiceEmail}
            onChange={(e) => set("customerServiceEmail", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Kundeservice-telefon</Label>
          <Input
            type="tel"
            value={form.customerServicePhone}
            onChange={(e) => set("customerServicePhone", e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <Label>Kontakt-e-post</Label>
          <Input
            type="email"
            value={form.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2">
          <Label>Refusjonspolicy</Label>
          <textarea
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-low)] px-3 py-2"
            rows={4}
            value={form.refundPolicyText}
            onChange={(e) => set("refundPolicyText", e.target.value)}
            required
          />
        </div>
      </div>
      {error ? <p className="text-red-400">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} size="lg">
          {busy ? "Oppretter…" : "Opprett organisasjon"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => router.push("/admin/platform/organizations")}
        >
          Avbryt
        </Button>
      </div>
    </form>
  );
}
