"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Obvious primary CTA to the full event editor. */
export function EditEventLink({
  eventId,
  variant = "default",
}: {
  eventId: string;
  variant?: "default" | "secondary";
}) {
  return (
    <Button asChild variant={variant} data-testid="edit-event-link">
      <Link href={`/admin/events/${eventId}/edit`}>Rediger arrangement</Link>
    </Button>
  );
}
