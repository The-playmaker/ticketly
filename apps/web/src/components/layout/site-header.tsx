import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-display text-xl tracking-wide text-zinc-50">
          Ticket<span className="text-amber-400">ly</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link href="/events" className="hidden text-sm text-zinc-300 hover:text-white sm:inline">
            Arrangementer
          </Link>
          {session?.user ? (
            <>
              <Link href="/my/tickets" className="text-sm text-zinc-300 hover:text-white">
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
