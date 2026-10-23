"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { orgRoleLabel } from "@/lib/auth/role-labels";
import { ScannerAccessDiagnostic } from "@/components/admin/scanner-access-diagnostic";

type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  eventAccess: { id: string; name: string; status?: string }[];
  status: "ACTIVE" | "DISABLED";
  lastActiveAt: string | Date | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
  restrictedEventIds: string[];
};

const ROLES = ["ORGANIZER_ADMIN", "EVENT_MANAGER", "DOOR_STAFF"] as const;

function usesEventAssignment(role: string) {
  return role === "DOOR_STAFF" || role === "EVENT_MANAGER";
}

function MemberEventAccessEditor({
  member,
  events,
  busy,
  onSave,
}: {
  member: Member;
  events: { id: string; name: string }[];
  busy: boolean;
  onSave: (eventIds: string[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState(() =>
    member.eventAccess.map((e) => e.id)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(member.eventAccess.map((e) => e.id));
  }, [member.eventAccess, member.userId, member.role]);

  if (!usesEventAssignment(member.role)) {
    return <span className="text-xs text-[color:var(--muted)]">Alle</span>;
  }

  const dirty =
    selected.length !== member.eventAccess.length ||
    selected.some((id) => !member.eventAccess.some((e) => e.id === id));

  return (
    <div className="min-w-[12rem] space-y-2">
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {events.length === 0 ? (
          <span className="text-xs text-[color:var(--muted)]">Ingen events</span>
        ) : (
          events.map((ev) => {
            const on = selected.includes(ev.id);
            return (
              <button
                key={ev.id}
                type="button"
                disabled={busy || saving}
                onClick={() =>
                  setSelected((prev) =>
                    on ? prev.filter((id) => id !== ev.id) : [...prev, ev.id]
                  )
                }
                className={`rounded-md px-2 py-1 text-xs ${
                  on
                    ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                    : "bg-[color:var(--surface-high)] text-[color:var(--muted)]"
                }`}
              >
                {ev.name}
              </button>
            );
          })
        )}
      </div>
      {member.role === "DOOR_STAFF" && selected.length === 0 ? (
        <p className="text-[10px] text-[color:var(--muted)]">
          Ingen (tildel events)
        </p>
      ) : null}
      {member.role === "EVENT_MANAGER" && selected.length === 0 ? (
        <p className="text-[10px] text-[color:var(--muted)]">
          Tom = alle events
        </p>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || saving || !dirty}
        onClick={async () => {
          setSaving(true);
          const ok = await onSave(selected);
          setSaving(false);
          if (ok) toast.success("Eventtilgang lagret");
        }}
      >
        Lagre tilgang
      </Button>
    </div>
  );
}

export function TeamAdminClient({
  organizationId,
  members,
  invitations,
  events,
}: {
  organizationId: string;
  members: Member[];
  invitations: Invite[];
  events: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("DOOR_STAFF");
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        email,
        role,
        restrictedEventIds: eventIds.length ? eventIds : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Invitasjon feilet");
      return;
    }
    setEmail("");
    setEventIds([]);
    router.refresh();
  }

  async function patch(
    userId: string,
    body: Record<string, unknown>
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, userId, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(data.error?.message ?? "Oppdatering feilet");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[color:var(--outline)]/35 p-5">
        <h2 className="font-medium">Inviter medlem</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="invite-email">E-post</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invite-role">Rolle</Label>
            <select
              id="invite-role"
              className="mt-1 w-full rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-container)] px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {orgRoleLabel(r)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {usesEventAssignment(role) ? (
          <div className="mt-3">
            <Label>
              Eventtilgang
              {role === "DOOR_STAFF"
                ? " (tom = ingen scanner-tilgang)"
                : " (valgfritt — tom = alle)"}
            </Label>
            <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {events.map((ev) => {
                const on = eventIds.includes(ev.id);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() =>
                      setEventIds((prev) =>
                        on ? prev.filter((id) => id !== ev.id) : [...prev, ev.id]
                      )
                    }
                    className={`rounded-md px-2 py-1 text-xs ${
                      on
                        ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                        : "bg-[color:var(--surface-high)] text-[color:var(--muted)]"
                    }`}
                  >
                    {ev.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        <Button className="mt-4" disabled={busy || !email} onClick={invite}>
          Send invitasjon
        </Button>
      </section>

      <section className="overflow-x-auto rounded-xl border border-[color:var(--outline)]/35">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-low)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Navn</th>
              <th className="px-3 py-2">E-post</th>
              <th className="px-3 py-2">Rolle</th>
              <th className="px-3 py-2">Eventtilgang</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Sist aktiv</th>
              <th className="px-3 py-2">Handlinger</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId} className="border-t border-[color:var(--outline)]/25">
                <td className="px-3 py-2 font-medium">{m.name}</td>
                <td className="px-3 py-2">{m.email}</td>
                <td className="px-3 py-2">
                  <select
                    className="rounded-md border border-[color:var(--outline)]/40 bg-transparent px-2 py-1 text-xs"
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      patch(m.userId, { action: "update", role: e.target.value })
                    }
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {orgRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 align-top">
                  <MemberEventAccessEditor
                    member={m}
                    events={events}
                    busy={busy}
                    onSave={(ids) =>
                      patch(m.userId, {
                        action: "update",
                        restrictedEventIds: ids,
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <Badge variant="muted">{m.status}</Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  {m.lastActiveAt
                    ? new Date(m.lastActiveAt).toLocaleString("nb-NO")
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        patch(m.userId, {
                          action: "update",
                          isActive: m.status !== "ACTIVE",
                        })
                      }
                    >
                      {m.status === "ACTIVE" ? "Disable access" : "Enable access"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => patch(m.userId, { action: "remove" })}
                    >
                      Remove from org
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invitations.length ? (
        <section className="rounded-xl border border-[color:var(--outline)]/35 p-5 text-sm">
          <h2 className="font-medium">Ventende invitasjoner</h2>
          <ul className="mt-3 space-y-2">
            {invitations.map((i) => (
              <li key={i.id} className="flex justify-between gap-4">
                <span>
                  {i.email} · {orgRoleLabel(i.role)}
                </span>
                <span className="text-xs text-[color:var(--muted)]">
                  utløper {new Date(i.expiresAt).toLocaleDateString("nb-NO")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ScannerAccessDiagnostic organizationId={organizationId} />
    </div>
  );
}
