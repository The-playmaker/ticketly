"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ResendOrderEmailButton({
  orderNumber,
  accessToken,
}: {
  orderNumber: string;
  accessToken: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderNumber}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Kunne ikke sende e-post");
      }
      setStatus("ok");
      setMessage(
        data.ok
          ? `E-post sendt til ${data.email}`
          : "Vi klarte ikke å sende e-posten akkurat nå. Billettene er fortsatt gyldige."
      );
    } catch (e) {
      setStatus("fail");
      setMessage(
        e instanceof Error
          ? e.message
          : "Vi klarte ikke å sende e-posten akkurat nå. Billettene er fortsatt gyldige."
      );
    }
  }

  return (
    <div className="rounded-xl border border-[color:var(--outline)]/30 bg-zinc-900/40 p-4">
      <Button variant="secondary" size="sm" disabled={status === "loading"} onClick={resend}>
        {status === "loading" ? "Sender…" : "Send e-post på nytt"}
      </Button>
      {message ? (
        <p className={`mt-2 text-sm ${status === "fail" ? "text-amber-300" : "text-zinc-400"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
