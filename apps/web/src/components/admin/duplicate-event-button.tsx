"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DuplicateEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate" }),
      });
      if (!res.ok) {
        setError("Kunne ikke duplisere");
        return;
      }
      const copy = (await res.json()) as { id: string };
      router.push(`/admin/events/${copy.id}/settings`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void onClick()}>
        Dupliser arrangement
      </Button>
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
