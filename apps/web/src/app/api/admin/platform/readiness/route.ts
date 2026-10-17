import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { prisma } from "@/lib/db";
import { nexiConfigHealth, resolvePaymentProviderType } from "@/lib/payments";
import { jsonError } from "@/lib/api-error";

const DEMO_EMAILS = [
  "admin@example.com",
  "organizer@example.com",
  "door@example.com",
  "customer@example.com",
];

/**
 * SUPER_ADMIN readiness — warns about demo data, email/payment config, seller gaps.
 * Never returns secrets or credential values.
 */
export async function GET() {
  try {
    await requireSuperAdmin();

    const warnings: { code: string; level: "warn" | "block"; message: string }[] = [];

    const demoUsers = await prisma.user.count({
      where: { email: { in: DEMO_EMAILS } },
    });
    if (demoUsers > 0 && process.env.NODE_ENV === "production") {
      warnings.push({
        code: "DEMO_USERS",
        level: "block",
        message: `${demoUsers} demo-brukere (@example.com) finnes i databasen`,
      });
    } else if (demoUsers > 0) {
      warnings.push({
        code: "DEMO_USERS",
        level: "warn",
        message: `${demoUsers} demo-brukere finnes (OK i development)`,
      });
    }

    const emailProvider = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();
    if (emailProvider === "console") {
      warnings.push({
        code: "EMAIL_CONSOLE",
        level: process.env.NODE_ENV === "production" ? "block" : "warn",
        message: "EMAIL_PROVIDER=console — transactional e-post går ikke til ekte mottakere",
      });
    }

    let paymentProvider = "unknown";
    try {
      paymentProvider = resolvePaymentProviderType();
      if (paymentProvider === "MOCK" && process.env.NODE_ENV === "production") {
        warnings.push({
          code: "PAYMENT_MOCK",
          level: "block",
          message: "PAYMENT_PROVIDER=mock er forbudt i produksjon",
        });
      }
    } catch (e) {
      warnings.push({
        code: "PAYMENT_CONFIG",
        level: "block",
        message: e instanceof Error ? e.message : "Betalingskonfigurasjon feilet",
      });
    }

    const nexi = nexiConfigHealth();
    if (nexi.status !== "operational" && paymentProvider === "NEXI") {
      warnings.push({
        code: "NEXI_CONFIG",
        level: "warn",
        message: nexi.message ?? "Nexi er ikke operational",
      });
    }

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
        message: `${incompleteSellers} organisasjon(er) mangler selgerfelter (juridisk navn / org.nr / support-e-post)`,
      });
    }

    const superAdmins = await prisma.user.count({
      where: { globalRole: "SUPER_ADMIN", isActive: true },
    });
    if (superAdmins < 1) {
      warnings.push({
        code: "NO_SUPER_ADMIN",
        level: "block",
        message: "Ingen aktiv SUPER_ADMIN — kjør npm run admin:create",
      });
    }

    // Pending migrations: Prisma migrate status is CLI-only; surface schema hint via missing table check
    let migrationsOk = true;
    try {
      await prisma.authActionToken.findFirst({ take: 1 });
    } catch {
      migrationsOk = false;
      warnings.push({
        code: "PENDING_MIGRATIONS",
        level: "block",
        message: "AuthActionToken mangler — kjør prisma migrate deploy",
      });
    }

    return NextResponse.json({
      ok: !warnings.some((w) => w.level === "block"),
      environment: process.env.NODE_ENV ?? "unknown",
      checks: {
        demoUsers,
        emailProvider,
        paymentProvider,
        nexiStatus: nexi.status,
        incompleteSellers,
        superAdmins,
        migrationsOk,
      },
      warnings,
    });
  } catch (e) {
    return jsonError(e);
  }
}
