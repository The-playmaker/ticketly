import { NextResponse } from "next/server";
import { EventService } from "@/services/event-service";
import { getAvailableQuantity, resolveUnitPrice } from "@/services/reservation-service";
import { getSellerOfRecord } from "@ticketly/ticketing";

type Props = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Props) {
  const { slug } = await params;
  const event = await EventService.getBySlug(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const seller = await getSellerOfRecord(event.sellerOrganizationId);

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      description: event.description,
      startsAt: event.startsAt,
      city: event.city,
      ageLimit: event.ageLimit,
      coverImageUrl: event.coverImageUrl,
      seller,
      refundPolicyText: event.refundPolicyText ?? event.organization.refundPolicyText,
      termsVersion: event.termsVersion ?? event.organization.termsVersion,
      ticketTypes: event.ticketTypes.map((t) => ({
        id: t.id,
        name: t.name,
        price: resolveUnitPrice(t),
        available: getAvailableQuantity(t),
      })),
    },
  });
}
