import { NextResponse } from "next/server";
import { ReservationService } from "@/services/reservation-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * External/manual cron: expire stale ACTIVE reservations and rebuild
 * TicketType.quantityReserved from DB truth.
 * Protect with CRON_SECRET (Authorization: Bearer …).
 *
 * Do NOT add to vercel.json crons (Hobby plan blocks schedules).
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET required" }, { status: 503 });
  }

  const url = new URL(req.url);
  const eventId = url.searchParams.get("event") ?? undefined;
  const dryRun = url.searchParams.get("dryRun") === "1";
  const limit = Number(url.searchParams.get("limit") ?? "50");

  if (dryRun && eventId) {
    const preview = await ReservationService.repairEvent({ eventId, apply: false });
    return NextResponse.json({
      dryRun: true,
      events: [preview],
      skipped: 0,
    });
  }

  if (dryRun) {
    return NextResponse.json(
      { error: "dryRun without event is not supported; pass ?event=<id>&dryRun=1" },
      { status: 400 }
    );
  }

  if (eventId) {
    const result = await ReservationService.repairEvent({
      eventId,
      apply: true,
    });
    return NextResponse.json({
      dryRun: false,
      events: [
        {
          eventId: result.eventId,
          expiredCount: result.expiredCount,
          types: result.types.map((t) => ({
            ticketTypeId: t.ticketTypeId,
            name: t.name,
            from: t.currentQuantityReserved,
            to: t.proposedQuantityReserved,
            delta: t.delta,
            availableAfter: t.availableAfter,
          })),
        },
      ],
      skipped: 0,
    });
  }

  const batch = await ReservationService.cleanupStaleReservations({
    force: true,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50,
  });

  return NextResponse.json({
    dryRun: false,
    skipped: batch.skipped,
    events: batch.events.map((e) => ({
      eventId: e.eventId,
      expiredCount: e.expiredCount,
      types: e.types.map((t) => ({
        ticketTypeId: t.ticketTypeId,
        name: t.name,
        from: t.currentQuantityReserved,
        to: t.proposedQuantityReserved,
        delta: t.delta,
        availableAfter: t.availableAfter,
      })),
    })),
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
