import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

async function loadReadiness() {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3456";
  // Prefer in-process call pattern via relative import of checks — fetch may not include cookies in SSR.
  // Import the handler logic inline by reusing prisma checks from the route module pattern.
  const { prisma } = await import("@/lib/db");
  const { nexiConfigHealth, resolvePaymentProviderType } = await import("@/lib/payments");

  const DEMO_EMAILS = [
    "admin@example.com",
    "organizer@example.com",
    "door@example.com",
    "customer@example.com",
  ];

  const warnings: { code: string; level: string; message: string }[] = [];
  const demoUsers = await prisma.user.count({ where: { email: { in: DEMO_EMAILS } } });
  if (demoUsers > 0) {
    warnings.push({
      code: "DEMO_USERS",
      level: process.env.NODE_ENV === "production" ? "block" : "warn",
      message: `${demoUsers} demo-brukere (@example.com)`,
    });
  }
  const emailProvider = process.env.EMAIL_PROVIDER ?? "console";
  if (emailProvider === "console") {
    warnings.push({
      code: "EMAIL_CONSOLE",
      level: process.env.NODE_ENV === "production" ? "block" : "warn",
      message: "EMAIL_PROVIDER=console",
    });
  }
  let paymentProvider = "unknown";
  try {
    paymentProvider = String(resolvePaymentProviderType());
  } catch (e) {
    warnings.push({
      code: "PAYMENT_CONFIG",
      level: "block",
      message: e instanceof Error ? e.message : "payment error",
    });
  }
  const nexi = nexiConfigHealth();
  const incompleteSellers = await prisma.organization.count({
    where: {
      isActive: true,
      OR: [
        { legalName: null },
        { organizationNumber: null },
        { AND: [{ customerServiceEmail: null }, { contactEmail: null }] },
      ],
    },
  });
  if (incompleteSellers > 0) {
    warnings.push({
      code: "INCOMPLETE_SELLER",
      level: "warn",
      message: `${incompleteSellers} org(er) med ufullstendig selgerinfo`,
    });
  }
  let migrationsOk = true;
  try {
    await prisma.authActionToken.findFirst({ take: 1 });
  } catch {
    migrationsOk = false;
    warnings.push({
      code: "PENDING_MIGRATIONS",
      level: "block",
      message: "Kjør prisma migrate deploy",
    });
  }

  return {
    ok: !warnings.some((w) => w.level === "block"),
    checks: {
      demoUsers,
      emailProvider,
      paymentProvider,
      nexiStatus: nexi.status,
      incompleteSellers,
      migrationsOk,
      appUrl: base,
    },
    warnings,
  };
}

export default async function PlatformReadinessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/platform/readiness");
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) redirect("/admin");

  const data = await loadReadiness();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Produksjonsklarhet</h1>
        <p className="text-sm text-[color:var(--muted)]">
          SUPER_ADMIN — ingen hemmeligheter vises. Status:{" "}
          <span className={data.ok ? "text-emerald-400" : "text-amber-400"}>
            {data.ok ? "OK" : "BLOKKERT / ADVARSLER"}
          </span>
        </p>
      </div>

      <section className="rounded-xl border border-[color:var(--outline)]/35 p-5 text-sm">
        <h2 className="font-medium">Sjekker</h2>
        <dl className="mt-3 space-y-2">
          {Object.entries(data.checks).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">{k}</dt>
              <dd className="font-mono text-xs">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-[color:var(--outline)]/35 p-5 text-sm">
        <h2 className="font-medium">Advarsler</h2>
        {!data.warnings.length ? (
          <p className="mt-2 text-[color:var(--muted)]">Ingen advarsler.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.warnings.map((w) => (
              <li key={w.code} className="flex gap-2">
                <span
                  className={
                    w.level === "block" ? "text-red-400" : "text-amber-400"
                  }
                >
                  [{w.level}]
                </span>
                <span>
                  {w.code}: {w.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/admin/platform/users" className="text-sm underline">
        ← Plattformbrukere
      </Link>
    </div>
  );
}
