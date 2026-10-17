"use client";

import { useState } from "react";
import { CreateEventWizard } from "@/components/admin/create-event-wizard";

type Org = {
  id: string;
  name: string;
  defaultServiceFee: number;
  defaultCurrency: string;
};

export function CreateEventOrgPicker({ organizations }: { organizations: Org[] }) {
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const selected = organizations.find((o) => o.id === orgId) ?? organizations[0];

  if (!selected) return null;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="create-event-org" className="text-sm font-medium">
          Organisasjon
        </label>
        <select
          id="create-event-org"
          className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
          value={selected.id}
          onChange={(e) => setOrgId(e.target.value)}
          data-testid="create-event-org-picker"
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <CreateEventWizard
        key={selected.id}
        organizationId={selected.id}
        defaultServiceFee={selected.defaultServiceFee}
        currency={selected.defaultCurrency}
      />
    </div>
  );
}
