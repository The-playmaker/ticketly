"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Organization } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SellerSettingsForm({ org }: { org: Organization }) {
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
    vatRegistrationStatus: org.vatRegistrationStatus,
    termsVersion: org.termsVersion,
    refundPolicyText: org.refundPolicyText ?? "",
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
        displayName: form.name,
        legalName: form.legalName,
        organizationNumber: form.organizationNumber,
        legalAddress: form.legalAddress,
        legalPostalCode: form.legalPostalCode,
        legalCity: form.legalCity,
        legalCountry: form.legalCountry,
        customerServiceEmail: form.customerServiceEmail,
        customerServicePhone: form.customerServicePhone || undefined,
        contactEmail: form.contactEmail || form.customerServiceEmail,
        vatRegistrationStatus: form.vatRegistrationStatus,
        termsVersion: form.termsVersion,
        refundPolicyText: form.refundPolicyText || undefined,
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
      <h2 className="font-medium">Seller of record</h2>
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
          <Label>Org.nr</Label>
          <Input
            value={form.organizationNumber}
            onChange={(e) => set("organizationNumber", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>VAT-status</Label>
          <select
            className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-low)] px-3 py-2"
            value={form.vatRegistrationStatus}
            onChange={(e) =>
              set(
                "vatRegistrationStatus",
                e.target.value as Organization["vatRegistrationStatus"]
              )
            }
          >
            <option value="UNKNOWN">UNKNOWN</option>
            <option value="REGISTERED">REGISTERED</option>
            <option value="NOT_REGISTERED">NOT_REGISTERED</option>
            <option value="EXEMPT">EXEMPT</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <Label>Adresse</Label>
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
          />
        </div>
        <div>
          <Label>Support-e-post</Label>
          <Input
            type="email"
            value={form.customerServiceEmail}
            onChange={(e) => set("customerServiceEmail", e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Support-telefon</Label>
          <Input
            value={form.customerServicePhone}
            onChange={(e) => set("customerServicePhone", e.target.value)}
          />
        </div>
        <div>
          <Label>Vilkårsversjon</Label>
          <Input
            value={form.termsVersion}
            onChange={(e) => set("termsVersion", e.target.value)}
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
      <Button type="submit" disabled={busy}>
        {busy ? "Lagrer…" : "Lagre selgerinfo"}
      </Button>
    </form>
  );
}
