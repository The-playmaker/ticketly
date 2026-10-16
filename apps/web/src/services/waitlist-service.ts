import { randomBytes } from "crypto";
import { WaitlistStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { getEmailProvider } from "@/lib/email/provider";

const DEFAULT_INVITE_TTL_MINUTES = 30;

export class WaitlistService {
  static async join(input: {
    eventId: string;
    ticketTypeId?: string;
    email: string;
    name?: string;
    phone?: string;
    requestedQuantity?: number;
  }) {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: input.eventId } });
    if (!event.waitlistEnabled) {
      throw new AppError("WAITLIST_DISABLED", "Venteliste er ikke aktivert", 400);
    }

    const email = input.email.trim().toLowerCase();
    const qty = Math.max(1, Math.min(20, input.requestedQuantity ?? 1));

    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        eventId: input.eventId,
        email,
        ticketTypeId: input.ticketTypeId ?? null,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.INVITED] },
      },
    });
    if (existing) {
      return { entry: existing, created: false };
    }

    const entry = await prisma.waitlistEntry.create({
      data: {
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId ?? null,
        email,
        name: input.name?.trim() || null,
        phone: input.phone?.trim() || null,
        requestedQuantity: qty,
        quantity: qty,
        status: WaitlistStatus.WAITING,
      },
    });

    return { entry, created: true };
  }

  static async list(eventId: string, status?: WaitlistStatus) {
    return prisma.waitlistEntry.findMany({
      where: { eventId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
      include: { ticketType: { select: { id: true, name: true } } },
    });
  }

  static async inviteNext(
    eventId: string,
    count: number,
    opts?: { actorId?: string; organizationId?: string; ttlMinutes?: number }
  ) {
    const n = Math.max(1, Math.min(100, count));
    const ttl = opts?.ttlMinutes ?? DEFAULT_INVITE_TTL_MINUTES;
    const appUrl = process.env.APP_URL ?? "http://localhost:3456";

    const waiting = await prisma.waitlistEntry.findMany({
      where: { eventId, status: WaitlistStatus.WAITING },
      orderBy: { createdAt: "asc" },
      take: n,
      include: { event: true },
    });

    const invited = [];
    for (const entry of waiting) {
      const token = randomBytes(24).toString("base64url");
      const expires = new Date(Date.now() + ttl * 60_000);
      const updated = await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: WaitlistStatus.INVITED,
          inviteToken: token,
          inviteExpiresAt: expires,
          notifiedAt: new Date(),
        },
      });

      const claimUrl = `${appUrl}/events/${entry.event.slug}?waitlist=${token}`;
      try {
        await getEmailProvider().send({
          to: { email: entry.email, name: entry.name ?? undefined },
          subject: `Venteliste: billetter tilgjengelig – ${entry.event.name}`,
          text: `Hei${entry.name ? ` ${entry.name}` : ""}!\n\nDet er nå tilgjengelige billetter til ${entry.event.name}.\nKjøp innen ${ttl} minutter:\n${claimUrl}\n`,
          html: `<p>Hei${entry.name ? ` ${entry.name}` : ""}!</p><p>Det er nå tilgjengelige billetter til <strong>${entry.event.name}</strong>.</p><p><a href="${claimUrl}">Sikre billetter</a> (utløper om ${ttl} min).</p>`,
        });
      } catch {
        // invitation still stored; email failure is non-fatal for ops
      }

      invited.push(updated);
      await writeAuditLog({
        actorId: opts?.actorId,
        organizationId: opts?.organizationId,
        action: "WAITLIST_INVITED",
        entityType: "WaitlistEntry",
        entityId: entry.id,
        metadata: { eventId, email: entry.email },
      });
    }

    return invited;
  }

  static async claimInvite(token: string) {
    const entry = await prisma.waitlistEntry.findUnique({
      where: { inviteToken: token },
      include: { event: true, ticketType: true },
    });
    if (!entry) throw new AppError("WAITLIST_INVITE_INVALID", "Ugyldig venteliste-lenke", 404);
    if (entry.status === WaitlistStatus.CLAIMED) return entry;
    if (entry.status !== WaitlistStatus.INVITED) {
      throw new AppError("WAITLIST_INVITE_INVALID", "Invitasjonen er ikke gyldig", 409);
    }
    if (entry.inviteExpiresAt && entry.inviteExpiresAt < new Date()) {
      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: WaitlistStatus.EXPIRED },
      });
      throw new AppError("WAITLIST_INVITE_EXPIRED", "Invitasjonen har utløpt", 410);
    }

    const claimed = await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: WaitlistStatus.CLAIMED, claimedAt: new Date() },
    });

    await writeAuditLog({
      organizationId: entry.event.organizationId,
      action: "WAITLIST_CLAIMED",
      entityType: "WaitlistEntry",
      entityId: entry.id,
    });

    return claimed;
  }

  static async countWaiting(eventId: string) {
    return prisma.waitlistEntry.count({
      where: { eventId, status: WaitlistStatus.WAITING },
    });
  }
}
