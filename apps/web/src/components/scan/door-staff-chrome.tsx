import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Minimal nav for DOOR_STAFF-only users: Scanner + Logg ut. */
export function DoorStaffChrome({ email }: { email?: string | null }) {
  return (
    <header className="flex h-12 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-4">
        <Link
          href="/scan"
          className="font-display text-sm font-semibold uppercase tracking-wider text-amber-400"
        >
          Scanner
        </Link>
        {email ? (
          <span className="hidden truncate text-xs text-zinc-500 sm:inline">{email}</span>
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
