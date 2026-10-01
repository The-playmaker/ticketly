import { NextResponse } from "next/server";
import { EventService } from "@/services/event-service";
import { resolveUnitPrice, getAvailableQuantity } from "@/services/reservation-service";

export async function GET() {
  const events = await EventService.listPublic({ take: 50 });
  return NextResponse.json({
    events: events.map((e) => {
      const prices = e.ticketTypes.map((t) => resolveUnitPrice(t));
      return {
        id: e.id,
        name: e.name,
        slug: e.slug,
        startsAt: e.startsAt,
        city: e.city,
        coverImageUrl: e.coverImageUrl,
        organization: e.organization,
        fromPrice: prices.length ? Math.min(...prices) : undefined,
      };
    }),
  });
}
