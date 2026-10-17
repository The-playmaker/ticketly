"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ADMIN_ORG_GLOBAL } from "@/lib/admin/org-context-constants";

export type OrgSwitcherOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type Props = {
  organizations: OrgSwitcherOption[];
  /** Current selection: org id, or null for global. */
  selectedOrganizationId: string | null;
  mode: "global" | "organization" | "none";
  allowGlobal?: boolean;
};

export function OrgContextSwitcher({
  organizations,
  selectedOrganizationId,
  mode,
  allowGlobal = true,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const value =
    mode === "organization" && selectedOrganizationId
      ? selectedOrganizationId
      : allowGlobal
        ? ADMIN_ORG_GLOBAL
        : "";

  async function onChange(next: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/org-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "Kunne ikke bytte organisasjon");
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feil");
    }
  }

  if (organizations.length === 0 && !allowGlobal) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid="org-context-switcher">
      <label className="sr-only" htmlFor="admin-org-context">
        Organisasjonskontekst
      </label>
      <select
        id="admin-org-context"
        className="max-w-[220px] truncate rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-2 py-1.5 text-xs text-foreground disabled:opacity-60"
        value={value}
        disabled={pending}
        onChange={(e) => void onChange(e.target.value)}
      >
        {allowGlobal ? (
          <option value={ADMIN_ORG_GLOBAL}>Alle organisasjoner</option>
        ) : (
          <option value="" disabled>
            Velg organisasjon…
          </option>
        )}
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {!o.isActive ? " (inaktiv)" : ""}
          </option>
        ))}
      </select>
      {error ? <span className="text-[10px] text-[color:var(--accent)]">{error}</span> : null}
    </div>
  );
}
