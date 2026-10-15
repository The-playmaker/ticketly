"use client";

import { useEffect } from "react";

/** Fire-and-forget page view + UTM capture (no PII). */
export function TrackPageView({
  eventId,
  organizationId,
}: {
  eventId: string;
  organizationId: string;
}) {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      let sessionId = sessionStorage.getItem("ticketly_sid");
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem("ticketly_sid", sessionId);
      }
      void fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "PAGE_VIEW",
          eventId,
          organizationId,
          sessionId,
          path: window.location.pathname,
          referrer: document.referrer || undefined,
          utmSource: params.get("utm_source") ?? undefined,
          utmMedium: params.get("utm_medium") ?? undefined,
          utmCampaign: params.get("utm_campaign") ?? undefined,
          utmContent: params.get("utm_content") ?? undefined,
          utmTerm: params.get("utm_term") ?? undefined,
        }),
      });
    } catch {
      // ignore
    }
  }, [eventId, organizationId]);

  return null;
}
