import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { isDoorStaffOnly } from "@/lib/auth/event-access";
import { MobileNav } from "@/components/layout/mobile-nav";

export async function SiteHeader() {
  const session = await auth();
  const doorOnly = isDoorStaffOnly(session?.user);
  const staffHome = doorOnly ? "/scan" : "/admin";
  const staffLabel = doorOnly ? "Scanner" : "Admin";
  const hasStaffAccess =
    Boolean(session?.user) &&
    (session!.user.globalRole === "SUPER_ADMIN" || (session!.user.memberships?.length ?? 0) > 0);

  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--outline)]/30 bg-[color:var(--background)]/85 backdrop-blur-md supports-[backdrop-filter]:bg-[color:var(--background)]/75">
      <div className="tl-page flex h-16 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MobileNav
            isLoggedIn={Boolean(session?.user)}
            hasStaffAccess={hasStaffAccess}
            staffHome={staffHome}
            staffLabel={staffLabel}
          />
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-[0.14em] text-foreground uppercase focus-visible:rounded-sm"
          >
            Ticketly
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Hovednavigasjon">
          <Link
            href="/events"
            className="rounded-md px-3 py-2 text-sm text-[color:var(--muted)] transition hover:bg-[color:var(--surface-high)]/60 hover:text-foreground"
          >
            Arrangementer
          </Link>
          <Link
            href="/login?callbackUrl=/admin"
            className="rounded-md px-3 py-2 text-sm text-[color:var(--muted)] transition hover:bg-[color:var(--surface-high)]/60 hover:text-foreground"
          >
            For arrangører
          </Link>
          {session?.user ? (
            <>
              <Link
                href="/my/tickets"
                className="rounded-md px-3 py-2 text-sm text-[color:var(--muted)] transition hover:bg-[color:var(--surface-high)]/60 hover:text-foreground"
              >
                Mine billetter
              </Link>
              {hasStaffAccess ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={staffHome}>{staffLabel}</Link>
                </Button>
              ) : null}
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

        <div className="flex items-center gap-2 md:hidden">
          {session?.user ? (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
                <Link href="/my/tickets">Billetter</Link>
              </Button>
              {hasStaffAccess ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={staffHome}>{staffLabel}</Link>
                </Button>
              ) : null}
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Logg inn</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
