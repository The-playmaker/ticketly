"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEventTime } from "@/lib/time";

type ScanResult = {
  result: string;
  message: string;
  ticket?: {
    publicId: string;
    holderName: string | null;
    ticketType: string;
    checkedInAt?: string | null;
  };
  previousCheckInAt?: string | null;
};

const resultStyles: Record<string, string> = {
  SUCCESS: "bg-emerald-600",
  ALREADY_USED: "bg-red-600",
  INVALID: "bg-red-700",
  WRONG_EVENT: "bg-orange-500",
  CANCELLED: "bg-red-700",
  REFUNDED: "bg-red-700",
  EVENT_CANCELLED: "bg-red-700",
};

export function ScannerClient({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [mode, setMode] = useState<"scan" | "search">("scan");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      id: string;
      publicId: string;
      holderName: string | null;
      ticketType: string;
      status: string;
      orderNumber: string;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const lastToken = useRef<string>("");

  async function validateToken(token: string) {
    if (busy || token === lastToken.current) return;
    lastToken.current = token;
    setBusy(true);
    try {
      // Extract token from URL if full verify URL was encoded
      const match = token.match(/\/t\/verify\/([^/?#]+)/);
      const secureToken = match?.[1] ?? token;

      const res = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: secureToken, eventId, deviceId: "web-scanner" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Feil");
      setResult(data);
    } catch (e) {
      setResult({
        result: "INVALID",
        message: e instanceof Error ? e.message : "UGYLDIG BILLETT",
      });
    } finally {
      setBusy(false);
      setTimeout(() => {
        lastToken.current = "";
      }, 2500);
    }
  }

  useEffect(() => {
    if (mode !== "scan") return;
    let cancelled = false;

    async function start() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            void validateToken(decoded);
          },
          () => undefined
        );
      } catch {
        if (!cancelled) {
          setCameraError("Kamera ikke tilgjengelig — bruk manuell søk eller lim inn token.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      void scannerRef.current?.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eventId]);

  async function search() {
    const res = await fetch("/api/tickets/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, query }),
    });
    const data = await res.json();
    if (res.ok) setSearchResults(data.results ?? []);
  }

  async function manualCheckIn(ticketId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, eventId, deviceId: "web-scanner" }),
      });
      const data = await res.json();
      setResult(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Scanner</p>
        <h1 className="truncate font-display text-xl">{eventName}</h1>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant={mode === "scan" ? "default" : "secondary"} onClick={() => setMode("scan")}>
            Scan QR
          </Button>
          <Button size="sm" variant={mode === "search" ? "default" : "secondary"} onClick={() => setMode("search")}>
            Gjesteliste
          </Button>
        </div>
      </header>

      <div className="flex-1 p-4">
        {mode === "scan" ? (
          <div>
            <div id="qr-reader" className="overflow-hidden rounded-xl bg-black" />
            {cameraError ? <p className="mt-3 text-sm text-amber-400">{cameraError}</p> : null}
            <div className="mt-4">
              <Input
                placeholder="Lim inn token / URL"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void validateToken((e.target as HTMLInputElement).value);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Navn, e-post, telefon, billettnr, ordre…"
            />
            <Button className="w-full" onClick={search}>
              Søk
            </Button>
            <ul className="space-y-2">
              {searchResults.map((r) => (
                <li key={r.id} className="rounded-lg border border-zinc-800 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.holderName}</p>
                      <p className="text-xs text-zinc-500">
                        {r.ticketType} · {r.publicId} · {r.status}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || r.status === "CHECKED_IN"}
                      onClick={() => manualCheckIn(r.id)}
                    >
                      Check-in
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {result ? (
        <div
          className={`px-4 py-8 text-center ${resultStyles[result.result] ?? "bg-zinc-800"}`}
          onClick={() => setResult(null)}
        >
          <p className="font-display text-3xl tracking-wide">{result.message}</p>
          {result.ticket ? (
            <div className="mt-3 space-y-1 text-sm text-white/90">
              <p>{result.ticket.holderName}</p>
              <p>{result.ticket.ticketType}</p>
              {result.previousCheckInAt || result.ticket.checkedInAt ? (
                <p>
                  Innsjekket{" "}
                  {formatEventTime(
                    result.previousCheckInAt ?? result.ticket.checkedInAt!,
                    "Europe/Oslo"
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-4 text-xs text-white/70">Trykk for å scanne neste</p>
        </div>
      ) : null}
    </div>
  );
}
