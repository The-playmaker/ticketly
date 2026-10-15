"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WebhookReplayButton({ webhookEventId }: { webhookEventId: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function replay() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookEventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Replay feilet");
      setMsg(data.duplicate ? "Already processed" : "Replayed");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Feil");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={replay}>
        {loading ? "…" : "Replay"}
      </Button>
      {msg ? <span className="text-xs text-zinc-500">{msg}</span> : null}
    </div>
  );
}
