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
    ageLimit?: number | null;
    requireIdCheck?: boolean;
    accessNote?: string | null;
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
    <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col bg-[color:var(--background)] text-foreground">
      <header className="border-b border-[color:var(--outline)]/30 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
            ● Station armed
          </p>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            Online
          </span>
        </div>
        <h1 className="mt-1 truncate font-display text-xl font-semibold">
          <span className="text-[color:var(--accent)]">●</span> {eventName}
        </h1>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="lg"
            className="h-12"
            variant={mode === "scan" ? "default" : "secondary"}
            onClick={() => setMode("scan")}
          >
            Scan QR
          </Button>
          <Button
            size="lg"
            className="h-12"
            variant={mode === "search" ? "default" : "secondary"}
            onClick={() => setMode("search")}
          >
            Manuelt søk
          </Button>
        </div>
      </header>

      <div className="flex-1 p-4">
        {mode === "scan" ? (
          <div>
            <div className="relative overflow-hidden rounded-lg border border-[color:var(--accent)]/40 bg-black">
              <div id="qr-reader" className="min-h-[280px]" />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-6 top-6 h-8 w-8 border-l-2 border-t-2 border-[color:var(--accent)]" />
                <div className="absolute right-6 top-6 h-8 w-8 border-r-2 border-t-2 border-[color:var(--accent)]" />
                <div className="absolute bottom-6 left-6 h-8 w-8 border-b-2 border-l-2 border-[color:var(--accent)]" />
                <div className="absolute bottom-6 right-6 h-8 w-8 border-b-2 border-r-2 border-[color:var(--accent)]" />
                <div className="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-[color:var(--accent)]/80" />
              </div>
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent-soft)]">
                ● Sentrer QR-kode
              </p>
            </div>
            {cameraError ? (
              <p className="mt-3 text-sm text-[color:var(--warning)]">{cameraError}</p>
            ) : null}
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
            <Button className="h-12 w-full" size="lg" onClick={search}>
              Søk gjest
            </Button>
            <ul className="space-y-2">
              {searchResults.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.holderName}</p>
                      <p className="text-xs text-[color:var(--muted)]">
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
          className={`px-4 py-8 text-center ${resultStyles[result.result] ?? "bg-[color:var(--surface-high)]"}`}
          onClick={() => setResult(null)}
        >
          <p className="font-display text-4xl font-bold tracking-wide">{result.message}</p>
          {result.result === "SUCCESS" && result.ticket ? (
            <div className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm text-white">
              {result.ticket.requireIdCheck || result.ticket.ageLimit != null ? (
                <div className="rounded-lg bg-black/25 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                    Alderskrav
                  </p>
                  <p className="text-lg font-semibold">
                    {result.ticket.ageLimit != null ? `${result.ticket.ageLimit}+` : "—"}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                    Kontroller legitimasjon
                  </p>
                </div>
              ) : null}
              <p>
                <span className="text-white/70">Navn:</span> {result.ticket.holderName ?? "—"}
              </p>
              <p>
                <span className="text-white/70">Billettype:</span> {result.ticket.ticketType}
              </p>
              {result.ticket.accessNote ? (
                <p>
                  <span className="text-white/70">Merknad:</span> {result.ticket.accessNote}
                </p>
              ) : null}
            </div>
          ) : null}
          {result.result === "ALREADY_USED" ? (
            <p className="mt-3 text-sm text-white/90">
              Tidligere skannet{" "}
              {formatEventTime(
                result.previousCheckInAt ?? result.ticket?.checkedInAt ?? new Date().toISOString(),
                "Europe/Oslo"
              )}
            </p>
          ) : null}
          {result.result !== "SUCCESS" && result.ticket?.holderName ? (
            <p className="mt-3 text-sm text-white/80">{result.ticket.holderName}</p>
          ) : null}
          <p className="mt-4 text-xs text-white/70">Trykk for å scanne neste</p>
        </div>
      ) : null}
    </div>
  );
}
