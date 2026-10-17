/**
 * Remove ONLY known demo/seed identities. Never runs automatically.
 *
 *   npm run demo:cleanup -- --dry-run
 *   npm run demo:cleanup -- --confirm-demo-delete
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_EMAILS = [
  "admin@example.com",
  "organizer@example.com",
  "door@example.com",
  "customer@example.com",
  "guest@example.com",
  "promo@example.com",
];

const DEMO_ORG_SLUGS = ["titan-events", "shot-spot", "bloms", "noir", "festival-as"];
const DEMO_EVENT_SLUGS = ["friday-night", "ticketly-payment-test"];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || !args.includes("--confirm-demo-delete");

  if (process.env.NODE_ENV === "production" && !args.includes("--allow-production")) {
    console.error(
      "Refusing demo cleanup in NODE_ENV=production without --allow-production (dangerous)."
    );
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true, email: true },
  });
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: DEMO_ORG_SLUGS } },
    select: { id: true, slug: true, name: true },
  });
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { slug: { in: DEMO_EVENT_SLUGS } },
        { organizationId: { in: orgs.map((o) => o.id) } },
      ],
    },
    select: { id: true, slug: true, name: true, organizationId: true },
  });

  console.log("Demo inventory (stable identifiers only):");
  console.log("  Users:", users.map((u) => u.email).join(", ") || "(none)");
  console.log("  Orgs:", orgs.map((o) => o.slug).join(", ") || "(none)");
  console.log("  Events:", events.map((e) => e.slug).join(", ") || "(none)");

  if (dryRun) {
    console.log("\nDry-run only. Re-run with --confirm-demo-delete to delete these records.");
    return;
  }

  console.warn("Deleting confirmed demo records…");

  const eventIds = events.map((e) => e.id);
  const orgIds = orgs.map((o) => o.id);
  const userIds = users.map((u) => u.id);

  if (eventIds.length) {
    await prisma.checkIn.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.guestListEntry.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventAssignment.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  if (orgIds.length) {
    await prisma.organizationInvitation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.promoCode.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }

  if (userIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log("Demo cleanup complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
