import { PrismaClient, GlobalRole, OrgRole, EventStatus, Visibility, ServiceFeeMode, PaymentStatus, OrderStatus, TicketStatus, CheckInResult } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
function hashTicketToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function generatePublicTicketId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[buf[i]! % alphabet.length];
  return `TKT-${code}`;
}
const prisma = new PrismaClient();

const DEV_PASSWORD = "password123";

async function main() {
  console.log("Seeding Ticketly...");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  // Users
  const _admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      firstName: "Super",
      lastName: "Admin",
      name: "Super Admin",
      passwordHash,
      globalRole: GlobalRole.SUPER_ADMIN,
    },
  });

  const organizer = await prisma.user.upsert({
    where: { email: "organizer@example.com" },
    update: {},
    create: {
      email: "organizer@example.com",
      firstName: "Ola",
      lastName: "Arrangør",
      name: "Ola Arrangør",
      phone: "+47 900 00 001",
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
    },
  });

  const door = await prisma.user.upsert({
    where: { email: "door@example.com" },
    update: {},
    create: {
      email: "door@example.com",
      firstName: "Dør",
      lastName: "Vakt",
      name: "Dør Vakt",
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: "customer@example.com" },
    update: {},
    create: {
      email: "customer@example.com",
      firstName: "Kari",
      lastName: "Kunde",
      name: "Kari Kunde",
      phone: "+47 900 00 002",
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
    },
  });

  // Organizations
  const titan = await prisma.organization.upsert({
    where: { slug: "titan-events" },
    update: {},
    create: {
      name: "Titan Events",
      slug: "titan-events",
      description: "Nattklubb- og konsertarrangør i Oslo",
      legalName: "Titan Events AS",
      organizationNumber: "999999999",
      legalAddress: "Storgata 10",
      legalPostalCode: "0155",
      legalCity: "Oslo",
      legalCountry: "NO",
      contactEmail: "post@titanevents.example",
      customerServiceEmail: "support@titanevents.example",
      customerServicePhone: "+47 21 00 00 00",
      vatRegistrationStatus: "REGISTERED",
      termsVersion: "2026.1",
      refundPolicyType: "ORGANIZER_REFUND_POLICY",
      refundPolicyText: "Billetter refunderes kun ved kansellert arrangement, med mindre annet er avtalt. Ordinær angrerett gjelder normalt ikke for fritidsaktiviteter på bestemt tidspunkt.",
      defaultServiceFee: 2000,
      defaultServiceFeeMode: ServiceFeeMode.ON_TOP,
      allowRefunds: true,
    },
  });

  for (const [slug, name] of [
    ["shot-spot-org", "Shot Spot"],
    ["bloms", "Bloms"],
    ["noir", "Noir"],
    ["festival-as", "Festival AS"],
  ] as const) {
    await prisma.organization.upsert({
      where: { slug },
      update: {},
      create: {
        name,
        slug,
        defaultServiceFee: 2000,
        defaultServiceFeeMode: ServiceFeeMode.ON_TOP,
      },
    });
  }

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: titan.id, userId: organizer.id } },
    update: { role: OrgRole.ORGANIZER_ADMIN, canRefund: true },
    create: {
      organizationId: titan.id,
      userId: organizer.id,
      role: OrgRole.ORGANIZER_ADMIN,
      canRefund: true,
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: titan.id, userId: door.id } },
    update: { role: OrgRole.DOOR_STAFF },
    create: {
      organizationId: titan.id,
      userId: door.id,
      role: OrgRole.DOOR_STAFF,
    },
  });

  // Venue
  const venue = await prisma.venue.upsert({
    where: { id: "seed-venue-shot-spot" },
    update: {},
    create: {
      id: "seed-venue-shot-spot",
      organizationId: titan.id,
      name: "Shot Spot",
      address: "Storgata 10",
      postalCode: "0155",
      city: "Oslo",
      country: "NO",
      capacity: 500,
    },
  });

  // Event: Friday Night
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 14);
  startsAt.setHours(22, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setHours(endsAt.getHours() + 5);
  const doorsOpenAt = new Date(startsAt);
  doorsOpenAt.setHours(doorsOpenAt.getHours() - 1);

  let event = await prisma.event.findFirst({
    where: { organizationId: titan.id, slug: "friday-night" },
  });

  if (!event) {
    event = await prisma.event.create({
      data: {
        organizationId: titan.id,
        sellerOrganizationId: titan.id,
        venueId: venue.id,
        name: "Friday Night",
        slug: "friday-night",
        shortDescription: "Den definitive fredagsfesten på Shot Spot",
        description:
          "Friday Night er Titan Events sin signaturfest. Forvent sterke DJ-er, premium bar og en atmosfære bygget for nattklubb. Dørene åpner kl. 21:00. Aldersgrense 20 år.",
        address: "Storgata 10",
        postalCode: "0155",
        city: "Oslo",
        country: "NO",
        timezone: "Europe/Oslo",
        startsAt,
        endsAt,
        doorsOpenAt,
        ageLimit: 20,
        coverImageUrl:
          "https://images.unsplash.com/photo-1571266028247-d4bfb64ffb3e?w=1600&q=80",
        capacity: 500,
        status: EventStatus.PUBLISHED,
        visibility: Visibility.PUBLIC,
        allowTransfer: true,
        serviceFee: 2000,
        serviceFeeMode: ServiceFeeMode.ON_TOP,
        currency: "NOK",
      },
    });
  }

  await prisma.eventAssignment.upsert({
    where: { eventId_userId: { eventId: event.id, userId: door.id } },
    update: {},
    create: { eventId: event.id, userId: door.id, role: OrgRole.DOOR_STAFF },
  });

  // Ticket types
  async function upsertTicketType(
    name: string,
    price: number,
    quantityTotal: number,
    sortOrder: number,
    tiers?: { name: string; price: number; quantityFrom: number; quantityTo: number }[]
  ) {
    const existing = await prisma.ticketType.findFirst({
      where: { eventId: event!.id, name },
    });
    if (existing) return existing;

    return prisma.ticketType.create({
      data: {
        eventId: event!.id,
        name,
        description: `${name} billett til Friday Night`,
        price,
        vatRate: 2500,
        quantityTotal,
        maxPerOrder: 8,
        minPerOrder: 1,
        isVisible: true,
        sortOrder,
        priceTiers: tiers
          ? {
              create: tiers.map((t, i) => ({
                name: t.name,
                price: t.price,
                quantityFrom: t.quantityFrom,
                quantityTo: t.quantityTo,
                sortOrder: i,
              })),
            }
          : undefined,
      },
    });
  }

  const earlyBird = await upsertTicketType("Early Bird", 19900, 100, 0, [
    { name: "Early Bird", price: 19900, quantityFrom: 0, quantityTo: 99 },
  ]);
  const ordinary = await upsertTicketType("Ordinær", 29900, 350, 1, [
    { name: "Fase 2", price: 24900, quantityFrom: 0, quantityTo: 199 },
    { name: "Ordinær", price: 29900, quantityFrom: 200, quantityTo: 349 },
  ]);
  const vip = await upsertTicketType("VIP", 49900, 50, 2);

  // Guest / comps — not publicly purchasable
  const existingGuest = await prisma.ticketType.findFirst({
    where: { eventId: event.id, name: "Guest List" },
  });
  if (!existingGuest) {
    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: "Guest List",
        description: "Gratis gjesteliste — kun via arrangør",
        price: 0,
        quantityTotal: 100,
        maxPerOrder: 1,
        minPerOrder: 1,
        isVisible: false,
        isPubliclyPurchasable: false,
        sortOrder: 99,
      },
    });
  }
  void vip;

  // Promo
  await prisma.promoCode.upsert({
    where: {
      organizationId_code: { organizationId: titan.id, code: "VIP20" },
    },
    update: {},
    create: {
      organizationId: titan.id,
      eventId: event.id,
      code: "VIP20",
      discountType: "PERCENTAGE",
      discountValue: 2000, // 20%
      maxUses: 100,
    },
  });

  // Sample paid order + tickets + check-ins
  const existingOrder = await prisma.order.findFirst({
    where: { orderNumber: "TKT-2026-000001" },
  });

  if (!existingOrder) {
    const order = await prisma.order.create({
      data: {
        orderNumber: "TKT-2026-000001",
        organizationId: titan.id,
        eventId: event.id,
        customerId: customer.id,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerFirstName: "Kari",
        customerLastName: "Kunde",
        subtotal: 29900 * 2,
        serviceFee: 4000,
        tax: 0,
        discount: 0,
        total: 29900 * 2 + 4000,
        currency: "NOK",
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.CONFIRMED,
        paidAt: new Date(),
        items: {
          create: [
            {
              ticketTypeId: ordinary.id,
              quantity: 2,
              unitPrice: 29900,
              serviceFee: 4000,
              tax: 0,
              total: 29900 * 2 + 4000,
              name: "Ordinær",
            },
          ],
        },
        payments: {
          create: {
            provider: "STRIPE",
            providerPaymentId: "seed_pi_001",
            providerSessionId: "seed_cs_001",
            amount: 29900 * 2 + 4000,
            currency: "NOK",
            status: PaymentStatus.PAID,
            idempotencyKey: "seed_payment_001",
          },
        },
      },
      include: { items: true },
    });

    await prisma.ticketType.update({
      where: { id: ordinary.id },
      data: { quantitySold: { increment: 2 } },
    });

    const item = order.items[0]!;
    const raw1 = generateSecureToken();
    const raw2 = generateSecureToken();
    const t1 = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(raw1),
        secureToken: raw1, // seed only — production issues cipher-only
        orderId: order.id,
        orderItemId: item.id,
        eventId: event.id,
        ticketTypeId: ordinary.id,
        holderName: "Kari Kunde",
        holderEmail: customer.email,
        status: TicketStatus.CHECKED_IN,
        checkedInAt: new Date(),
      },
    });
    await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(raw2),
        secureToken: raw2,
        orderId: order.id,
        orderItemId: item.id,
        eventId: event.id,
        ticketTypeId: ordinary.id,
        holderName: "Kari Kunde",
        holderEmail: customer.email,
        status: TicketStatus.VALID,
      },
    });

    await prisma.checkIn.create({
      data: {
        ticketId: t1.id,
        eventId: event.id,
        checkedInBy: door.id,
        result: CheckInResult.SUCCESS,
        deviceId: "seed-scanner",
      },
    });

    await prisma.orderSequence.upsert({
      where: { id: "2026" },
      update: { counter: 1 },
      create: { id: "2026", counter: 1 },
    });
  }

  // Guest list
  const guestCount = await prisma.guestListEntry.count({ where: { eventId: event.id } });
  if (guestCount === 0) {
    await prisma.guestListEntry.createMany({
      data: [
        {
          eventId: event.id,
          ticketTypeId: vip.id,
          name: "Artist Guest",
          email: "guest@example.com",
          phone: "+47 900 00 010",
          comment: "DJ +1",
          partySize: 2,
          createdById: organizer.id,
        },
        {
          eventId: event.id,
          ticketTypeId: earlyBird.id,
          name: "Promoter Lista",
          email: "promo@example.com",
          partySize: 3,
          comment: "+2",
          createdById: organizer.id,
        },
      ],
    });
  }

  console.log("Seed complete.");
  console.log("─── Development credentials (NOT for production) ───");
  console.log(`  admin@example.com      / ${DEV_PASSWORD}  (SUPER_ADMIN)`);
  console.log(`  organizer@example.com  / ${DEV_PASSWORD}  (ORGANIZER_ADMIN)`);
  console.log(`  door@example.com       / ${DEV_PASSWORD}  (DOOR_STAFF)`);
  console.log(`  customer@example.com   / ${DEV_PASSWORD}  (CUSTOMER)`);
  console.log(`  Event: /events/friday-night`);
  console.log(`  Promo: VIP20 (20%)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
