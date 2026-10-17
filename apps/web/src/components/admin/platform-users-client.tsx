"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  globalRole: string;
  organizations: { id: string; name: string; role: string; isActive: boolean }[];
  lastActiveAt: string | Date | null;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  createdAt: string | Date;
  mfa: string;
  isActive: boolean;
};

export function PlatformUsersClient({
  initialUsers,
  initialQ,
  initialStatus,
  initialRole,
}: {
  initialUsers: UserRow[];
  initialQ: string;
  initialStatus: string;
  initialRole: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [busy, setBusy] = useState<string | null>(null);
  const [audit, setAudit] = useState<{ id: string; logs: unknown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyFilters(next?: { status?: string; role?: string }) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("status", next?.status ?? initialStatus);
    params.set("role", next?.role ?? initialRole);
    router.push(`/admin/platform/users?${params.toString()}`);
  }

  async function action(userId: string, actionName: string, globalRole?: string) {
    setBusy(userId + actionName);
    setError(null);
    const res = await fetch("/api/admin/platform/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: actionName, globalRole }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Handling feilet");
      return;
    }
    router.refresh();
  }

  async function viewAudit(userId: string) {
    setBusy(userId + "audit");
    const res = await fetch(`/api/admin/platform/users/${userId}/audit`);
    setBusy(null);
    if (!res.ok) {
      setError("Kunne ikke hente audit");
      return;
    }
    const data = (await res.json()) as { logs: unknown[] };
    setAudit({ id: userId, logs: data.logs });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Søk navn, e-post, org…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Button type="button" variant="secondary" onClick={() => applyFilters()}>
          Søk
        </Button>
        {(["ALL", "ACTIVE", "INVITED", "DISABLED"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => applyFilters({ status: s })}
            className={`rounded-md px-2.5 py-1 text-xs ${
              initialStatus === s
                ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                : "bg-[color:var(--surface-high)] text-[color:var(--muted)]"
            }`}
          >
            {s}
          </button>
        ))}
        {(["ALL", "SUPER_ADMIN", "CUSTOMER"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => applyFilters({ role: r })}
            className={`rounded-md px-2.5 py-1 text-xs ${
              initialRole === r
                ? "bg-[color:var(--surface-bright)] text-foreground"
                : "bg-[color:var(--surface-high)] text-[color:var(--muted)]"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[color:var(--outline)]/35">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-low)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Navn</th>
              <th className="px-3 py-2">E-post</th>
              <th className="px-3 py-2">Telefon</th>
              <th className="px-3 py-2">Global rolle</th>
              <th className="px-3 py-2">Organisasjoner</th>
              <th className="px-3 py-2">Sist aktiv</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Opprettet</th>
              <th className="px-3 py-2">MFA</th>
              <th className="px-3 py-2">Handlinger</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.map((u) => (
              <tr key={u.id} className="border-t border-[color:var(--outline)]/25">
                <td className="px-3 py-2 font-medium">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.phone ?? "—"}</td>
                <td className="px-3 py-2">{u.globalRole}</td>
                <td className="px-3 py-2">
                  {u.organizations.length
                    ? u.organizations.map((o) => o.name).join(", ")
                    : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  {u.lastActiveAt
                    ? new Date(u.lastActiveAt).toLocaleString("nb-NO")
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="muted">{u.status}</Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  {new Date(u.createdAt).toLocaleDateString("nb-NO")}
                </td>
                <td className="px-3 py-2 text-xs">{u.mfa}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {u.isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => action(u.id, "disable")}
                      >
                        Disable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => action(u.id, "enable")}
                      >
                        Enable
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => action(u.id, "send_reset")}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        action(
                          u.id,
                          "set_role",
                          u.globalRole === "SUPER_ADMIN" ? "CUSTOMER" : "SUPER_ADMIN"
                        )
                      }
                    >
                      Rolle
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => viewAudit(u.id)}
                    >
                      Audit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {audit ? (
        <div className="rounded-xl border border-[color:var(--outline)]/35 p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Audit — {audit.id}</h2>
            <button type="button" className="text-xs underline" onClick={() => setAudit(null)}>
              Lukk
            </button>
          </div>
          <pre className="max-h-64 overflow-auto text-xs text-[color:var(--muted)]">
            {JSON.stringify(audit.logs, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
