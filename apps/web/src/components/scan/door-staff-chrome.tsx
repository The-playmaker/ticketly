import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Minimal nav for DOOR_STAFF-only users: Scanner + Logg ut. */
export function DoorStaffChrome({ email }: { email?: string | null }) {
  return (
    <header className="flex h-12 items-center justify-between gap-3 border-b border-[color:var(--outline)]/30 bg-[color:var(--surface-low)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/scan"
          className="font-display text-sm font-semibold uppercase tracking-wider text-[color:var(--accent)]"
        >
          Scanner
        </Link>
        {email ? (
          <span className="hidden truncate text-xs text-[color:var(--muted)] sm:inline">
            {email}
          </span>
        ) : null}
      </div>
      <form
        action={async () => {
          "use server";
          const { signOut } = await import("@/lib/auth");
          await signOut({ redirectTo: "/login" });
        }}
      >
        <Button type="submit" size="sm" variant="ghost">
          Logg ut
        </Button>
      </form>
    </header>
  );
}
