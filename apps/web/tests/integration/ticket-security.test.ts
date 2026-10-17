import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaClient,
  PaymentStatus,
  TicketStatus,
  TicketQrMode,
  CheckInResult,
  DevicePlatform,
} from "@prisma/client";
import { CheckInService } from "@/services/check-in-service";
import { TicketService } from "@/services/ticket-service";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";
import {
  parseDynamicQrCredential,
  signDynamicQrCredential,
  looksLikeDynamicQrCredential,
  isDynamicQrFeatureEnabled,
} from "@/lib/tickets/dynamic-qr";
import { DynamicQrService } from "@/services/dynamic-qr-service";
import { redactSensitiveString, redactSensitiveValue } from "@/lib/security/redact";
import {
  isSensitiveTicketPath,
  sanitizeAnalyticsPath,
} from "@/lib/security/sensitive-path";
import { OfflineScannerService } from "@ticketly/ticketing";

const prisma = new PrismaClient();

describe("ticket security hardening", () => {
  let eventId: string;
  let organizationId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    process.env.TICKET_TOKEN_SECRET =
      process.env.TICKET_TOKEN_SECRET ?? "ticket-secret-at-least-32-chars!!";
    // Keep dynamic QR off unless individual tests enable it
    delete process.env.ENABLE_DYNAMIC_QR;

    const event = await prisma.event.findFirst({
      where: { slug: "friday-night" },
      include: { ticketTypes: true },
    });
    if (!event) throw new Error("Seed data missing — run npm run db:seed");
    eventId = event.id;
    organizationId = event.organizationId;
    const tt = event.ticketTypes[0];
    if (!tt) throw new Error("ticket type missing");
    ticketTypeId = tt.id;

    await prisma.event.update({
      where: { id: eventId },
      data: { qrMode: TicketQrMode.STATIC_QR },
    });
  });

  afterAll(async () => {
    delete process.env.ENABLE_DYNAMIC_QR;
    await prisma.$disconnect();
  });

  async function createValidTicket(raw?: string) {
    const token = raw ?? generateSecureToken();
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-SEC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        organizationId,
        eventId,
        customerEmail: "sec@example.com",
        customerFirstName: "Sec",
        customerLastName: "Test",
        subtotal: 1000,
        total: 1000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: 1000,
            total: 1000,
            name: "Sec",
          },
        },
      },
      include: { items: true },
    });
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        secureToken: null,
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId,
        holderName: "Sec Test",
        holderEmail: "sec@example.com",
        status: TicketStatus.VALID,
      },
    });
    return { token, ticket, order };
  }

  it("rejects forged / unknown QR tokens", async () => {
    const forged = generateSecureToken();
    const result = await CheckInService.checkInByToken({ token: forged, eventId });
    expect(result.result).toBe(CheckInResult.INVALID);
  });

  it("rejects modified QR (tampered token)", async () => {
    const { token } = await createValidTicket();
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    const result = await CheckInService.checkInByToken({ token: tampered, eventId });
    expect(result.result).toBe(CheckInResult.INVALID);
  });

  it("copied QR admits exactly once — second scan ALREADY_USED", async () => {
    const { token } = await createValidTicket();
    const first = await CheckInService.checkInByToken({
      token,
      eventId,
      deviceId: "scanner-a",
    });
    const second = await CheckInService.checkInByToken({
      token,
      eventId,
      deviceId: "scanner-b",
    });
    expect(first.result).toBe(CheckInResult.SUCCESS);
    expect(second.result).toBe(CheckInResult.ALREADY_USED);
    expect(second.previousDeviceId).toBe("scanner-a");
  });

  it("two concurrent scanners → exactly one SUCCESS (real Postgres)", async () => {
    const { token } = await createValidTicket();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        CheckInService.checkInByToken({
          token,
          eventId,
          deviceId: `concurrent-${i}`,
        })
      )
    );
    const successes = results.filter((r) => r.result === CheckInResult.SUCCESS);
    const already = results.filter((r) => r.result === CheckInResult.ALREADY_USED);
    expect(successes.length).toBe(1);
    expect(already.length).toBe(7);
  });

  it("wrong event is rejected", async () => {
    const { token } = await createValidTicket();
    const other = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: "Other Sec Event",
        slug: `other-sec-${Date.now()}`,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 90000000),
        timezone: "Europe/Oslo",
        capacity: 10,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        currency: "NOK",
      },
    });
    const result = await CheckInService.checkInByToken({
      token,
      eventId: other.id,
    });
    expect(result.result).toBe(CheckInResult.WRONG_EVENT);
    await prisma.event.delete({ where: { id: other.id } });
  });

  it("transferred ticket invalidates old QR; new credentials work", async () => {
    const { token, ticket } = await createValidTicket();
    await TicketService.transferTicket({
      ticketId: ticket.id,
      toName: "New Holder",
      toEmail: "newholder@example.com",
    });
    const oldScan = await CheckInService.checkInByToken({ token, eventId });
    expect(oldScan.result).toBe(CheckInResult.INVALID);

    const refreshed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    // decrypt new token via service helper path — use cipher
    const { resolveRawTicketToken } = await import("@/lib/tickets/token");
    const newRaw = resolveRawTicketToken(refreshed);
    expect(newRaw).toBeTruthy();
    const newScan = await CheckInService.checkInByToken({ token: newRaw!, eventId });
    expect(newScan.result).toBe(CheckInResult.SUCCESS);
    expect(newScan.ticket?.holderName).toBe("New Holder");
  });

  it("cancelled ticket cannot check in", async () => {
    const { token, ticket } = await createValidTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: TicketStatus.CANCELLED },
    });
    const result = await CheckInService.checkInByToken({ token, eventId });
    expect(result.result).toBe(CheckInResult.CANCELLED);
  });

  it("revoked scanner device is rejected and audited", async () => {
    const { token } = await createValidTicket();
    const device = await prisma.device.create({
      data: {
        organizationId,
        deviceName: `revoked-${Date.now()}`,
        platform: DevicePlatform.ANDROID,
        revokedAt: new Date(),
      },
    });
    const result = await CheckInService.checkInByToken({
      token,
      eventId,
      deviceId: device.id,
    });
    expect(result.result).toBe(CheckInResult.INVALID);
    expect(result.message).toMatch(/DEAKTIVERT/i);
    const logged = await prisma.checkIn.findFirst({
      where: { eventId, deviceId: device.id, note: "device_revoked" },
    });
    expect(logged).toBeTruthy();
    await prisma.device.delete({ where: { id: device.id } });
  });

  it("force override requires reason path (service honors forceOverride)", async () => {
    const { ticket } = await createValidTicket();
    await CheckInService.checkInByTicketId({
      ticketId: ticket.id,
      eventId,
      deviceId: "web-scanner",
      checkedInBy: undefined,
    });
    const blocked = await CheckInService.checkInByTicketId({
      ticketId: ticket.id,
      eventId,
    });
    expect(blocked.result).toBe(CheckInResult.ALREADY_USED);

    const forced = await CheckInService.checkInByTicketId({
      ticketId: ticket.id,
      eventId,
      forceOverride: true,
      note: "VIP re-entry approved by manager",
      checkedInBy: undefined,
    });
    expect(forced.result).toBe(CheckInResult.SUCCESS);
  });

  it("redacts ticket credentials from log helpers", () => {
    const sample =
      "scan https://app.example/t/verify/abcdefghijklmnopqrstuvwxyz012345?x=1 accessToken=secrettokenvalue123456789012345678";
    expect(redactSensitiveString(sample)).not.toMatch(/abcdefghijklmnopqrstuvwxyz012345/);
    expect(redactSensitiveValue({ token: "supersecrettokenvalue", ok: true })).toEqual({
      token: "[redacted]",
      ok: true,
    });
  });

  it("analytics path sanitizer blocks order/ticket URLs", () => {
    expect(isSensitiveTicketPath("/orders/TKT-2026-1?t=abc")).toBe(true);
    expect(sanitizeAnalyticsPath("/orders/TKT-1")).toBe("/orders/[redacted]");
    expect(isSensitiveTicketPath("/events/friday-night")).toBe(false);
  });

  it("publicId alone is never enough — check-in requires token hash", async () => {
    const { ticket } = await createValidTicket();
    // Using publicId as if it were a token must fail
    const result = await CheckInService.checkInByToken({
      token: ticket.publicId.padEnd(16, "X"),
      eventId,
    });
    expect(result.result).toBe(CheckInResult.INVALID);
  });

  describe("dynamic QR foundation (feature flag)", () => {
    it("feature flag defaults OFF", () => {
      delete process.env.ENABLE_DYNAMIC_QR;
      expect(isDynamicQrFeatureEnabled()).toBe(false);
    });

    it("rejects dynamic credentials when feature flag is off", async () => {
      delete process.env.ENABLE_DYNAMIC_QR;
      const { ticket } = await createValidTicket();
      const cred = signDynamicQrCredential(
        {
          pid: ticket.publicId,
          eid: eventId,
          exp: Math.floor(Date.now() / 1000) + 30,
          n: "nonce1",
        },
        ticket.tokenHash
      );
      expect(looksLikeDynamicQrCredential(cred)).toBe(true);
      const result = await CheckInService.checkInByToken({ token: cred, eventId });
      expect(result.result).toBe(CheckInResult.INVALID);
    });

    it("with flag on: expiry, replay after check-in, MAC tamper, concurrent", async () => {
      process.env.ENABLE_DYNAMIC_QR = "true";
      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.DYNAMIC_QR, dynamicQrTtlSeconds: 30 },
      });

      const { ticket } = await createValidTicket();
      const minted = await DynamicQrService.mintForTicket({
        ticketId: ticket.id,
        authorized: true,
      });
      expect(minted.ttlSeconds).toBe(30);

      const expired = signDynamicQrCredential(
        {
          pid: ticket.publicId,
          eid: eventId,
          exp: Math.floor(Date.now() / 1000) - 120,
          n: "old",
        },
        ticket.tokenHash
      );
      const expiredParsed = parseDynamicQrCredential(expired);
      expect(expiredParsed.ok).toBe(false);

      const expiredScan = await CheckInService.checkInByToken({
        token: expired,
        eventId,
      });
      expect(expiredScan.result).toBe(CheckInResult.INVALID);
      expect(expiredScan.message).toMatch(/UTLØPT|UGYLDIG/);

      const good = minted.credential;
      const tampered = good.slice(0, -4) + "xxxx";
      const badMac = await CheckInService.checkInByToken({ token: tampered, eventId });
      expect(badMac.result).toBe(CheckInResult.INVALID);

      const [a, b] = await Promise.all([
        CheckInService.checkInByToken({ token: good, eventId, deviceId: "d1" }),
        CheckInService.checkInByToken({ token: good, eventId, deviceId: "d2" }),
      ]);
      const successes = [a, b].filter((r) => r.result === CheckInResult.SUCCESS);
      expect(successes.length).toBe(1);

      // Replay after check-in (even with freshly minted credential)
      const again = await DynamicQrService.mintForTicket({
        ticketId: ticket.id,
        authorized: true,
      }).catch((e: Error) => e);
      // Ticket no longer VALID — mint should fail
      expect(again).toBeInstanceOf(Error);

      // restore static mode for other suites
      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.STATIC_QR },
      });
      delete process.env.ENABLE_DYNAMIC_QR;
    });

    it("offline bundle refused for DYNAMIC_QR events", async () => {
      process.env.ENABLE_DYNAMIC_QR = "true";
      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.DYNAMIC_QR },
      });
      await expect(OfflineScannerService.createBundle(eventId, 1)).rejects.toThrow(
        /OFFLINE_BUNDLE_UNSUPPORTED|Dynamic QR/
      );
      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.STATIC_QR },
      });
      delete process.env.ENABLE_DYNAMIC_QR;
    });

    it("transfer rotates MAC key so prior dynamic credential fails", async () => {
      process.env.ENABLE_DYNAMIC_QR = "true";
      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.DYNAMIC_QR },
      });
      const { ticket } = await createValidTicket();
      const before = await DynamicQrService.mintForTicket({
        ticketId: ticket.id,
        authorized: true,
      });
      await TicketService.transferTicket({
        ticketId: ticket.id,
        toName: "Dyn Xfer",
        toEmail: "dynxfer@example.com",
      });
      const scan = await CheckInService.checkInByToken({
        token: before.credential,
        eventId,
      });
      expect(scan.result).toBe(CheckInResult.INVALID);

      await prisma.event.update({
        where: { id: eventId },
        data: { qrMode: TicketQrMode.STATIC_QR },
      });
      delete process.env.ENABLE_DYNAMIC_QR;
    });
  });
});
