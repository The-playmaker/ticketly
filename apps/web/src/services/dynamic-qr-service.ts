import { TicketQrMode, TicketStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import {
  buildDynamicQrPayload,
  clampDynamicQrTtlSeconds,
  isDynamicQrFeatureEnabled,
  signDynamicQrCredential,
} from "@/lib/tickets/dynamic-qr";

/**
 * Mint short-lived dynamic QR credentials for a ticket holder.
 * Auth is enforced by the API route (session owner or order access token).
 * NEVER mint from a presented static QR token alone.
 */
export class DynamicQrService {
  static assertFeatureReady(event: {
    qrMode: TicketQrMode;
    dynamicQrTtlSeconds: number;
  }) {
    if (!isDynamicQrFeatureEnabled()) {
      throw new AppError(
        "DYNAMIC_QR_DISABLED",
        "Dynamic QR er ikke aktivert (ENABLE_DYNAMIC_QR)",
        503
      );
    }
    if (event.qrMode !== TicketQrMode.DYNAMIC_QR) {
      throw new AppError(
        "DYNAMIC_QR_NOT_ENABLED_FOR_EVENT",
        "Dette arrangementet bruker statisk QR",
        409
      );
    }
  }

  static async mintForTicket(input: {
    ticketId: string;
    /** Caller already authorized as holder / access-token bearer */
    authorized: true;
  }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: input.ticketId },
      include: { event: true },
    });
    if (!ticket) throw new AppError("TICKET_NOT_FOUND", "Billett ikke funnet", 404);

    this.assertFeatureReady(ticket.event);

    if (ticket.status !== TicketStatus.VALID) {
      throw new AppError("TICKET_NOT_VALID", "Billett kan ikke vise dynamisk QR", 409);
    }
    if (!ticket.tokenHash) {
      throw new AppError("TOKEN_MISSING", "Billett mangler token", 409);
    }

    const ttl = clampDynamicQrTtlSeconds(ticket.event.dynamicQrTtlSeconds);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const claims = {
      pid: ticket.publicId,
      eid: ticket.eventId,
      exp,
      n: randomBytes(16).toString("base64url"),
    };
    const credential = signDynamicQrCredential(claims, ticket.tokenHash);
    return {
      credential,
      qrPayload: buildDynamicQrPayload(credential),
      expiresAt: new Date(exp * 1000).toISOString(),
      ttlSeconds: ttl,
      /** Explicit product disclaimer for clients */
      disclaimer:
        "Dynamisk QR hindrer ikke skjermbilder før utløp/innsjekk. Deling etter innsjekk avvises.",
    };
  }
}
