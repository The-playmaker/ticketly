"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Organization, VatRegistrationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const VAT_OPTIONS: VatRegistrationStatus[] = [
  "UNKNOWN",
  "REGISTERED",
  "NOT_REGISTERED",
  "EXEMPT",
];

export function EditOrganizationForm({ org }: { org: Organization }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: org.name,
    legalName: org.legalName ?? "",
    organizationNumber: org.organizationNumber ?? "",
    legalAddress: org.legalAddress ?? "",
    legalPostalCode: org.legalPostalCode ?? "",
    legalCity: org.legalCity ?? "",
    legalCountry: org.legalCountry ?? "NO",
    customerServiceEmail: org.customerServiceEmail ?? org.contactEmail ?? "",
    customerServicePhone: org.customerServicePhone ?? "",
    contactEmail: org.contactEmail ?? "",
    website: org.website ?? "",
    vatRegistrationStatus: org.vatRegistrationStatus,
    refundPolicyText: org.refundPolicyText ?? "",
    isActive: org.isActive,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/admin/organizations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: org.id,
        displayName: form.name.trim(),
        legalName: form.legalName.trim(),
        organizationNumber: form.organizationNumber.trim(),
        legalAddress: form.legalAddress.trim(),
        legalPostalCode: form.legalPostalCode.trim(),
        legalCity: form.legalCity.trim(),
        legalCountry: form.legalCountry.trim().toUpperCase(),
        customerServiceEmail: form.customerServiceEmail.trim(),
        customerServicePhone: form.customerServicePhone.trim() || undefined,
        contactEmail: form.contactEmail.trim() || form.customerServiceEmail.trim(),
        website: form.website.trim() || null,
        vatRegistrationStatus: form.vatRegistrationStatus,
        refundPolicyText: form.refundPolicyText.trim() || undefined,
        isActive: form.isActive,
      }),
    });

    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Lagring feilet");
      return;
    }
    setMessage("Lagret");
    router.refresh();
  }

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Rediger organisasjon</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
            className="h-4 w-4 rounded border-[color:var(--outline)]"
          />
          <span>{form.isActive ? "Aktiv" : "Inaktiv"}</span>
        </label>
      </div>
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
          />
        </div>
      </div>
      {error ? <p className="text-red-400">{error}</p> : null}
      {message ? <p className="text-emerald-400">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Lagrer…" : "Lagre"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => router.push("/admin/platform/organizations")}
        >
          Tilbake
        </Button>
      </div>
    </form>
  );
}
