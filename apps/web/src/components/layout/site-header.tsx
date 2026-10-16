import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--outline)]/30 bg-[color:var(--background)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-[0.14em] text-foreground uppercase"
        >
          Ticketly
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/events"
            className="hidden text-sm text-[color:var(--muted)] transition hover:text-foreground sm:inline"
          >
            Arrangementer
          </Link>
          <Link
            href="/login?callbackUrl=/admin"
            className="hidden text-sm text-[color:var(--muted)] transition hover:text-foreground md:inline"
          >
            For arrangører
          </Link>
          {session?.user ? (
            <>
              <Link
                href="/my/tickets"
                className="text-sm text-[color:var(--muted)] transition hover:text-foreground"
              >
                Mine billetter
              </Link>
              {(session.user.globalRole === "SUPER_ADMIN" ||
                (session.user.memberships?.length ?? 0) > 0) && (
                <Button asChild size="sm" variant="secondary">
                  <Link href="/admin">Admin</Link>
                </Button>
              )}
              <form
                action={async () => {
                  "use server";
                  const { signOut } = await import("@/lib/auth");
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button type="submit" size="sm" variant="ghost">
                  Logg ut
                </Button>
              </form>
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Logg inn</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
