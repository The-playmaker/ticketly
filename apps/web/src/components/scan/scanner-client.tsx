"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEventTime } from "@/lib/time";
import { cn } from "@/lib/utils";

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
  previousDeviceId?: string | null;
  previousCheckedInByName?: string | null;
  suggestedEventId?: string;
  suggestedEventName?: string;
  resolvedEventId?: string;
  resolvedEventName?: string;
};

function resultPanelClass(result: string) {
  if (result === "PENDING") return "tl-scan-pending";
  if (result === "SUCCESS") return "tl-scan-valid";
  if (result === "ALREADY_USED") return "tl-scan-duplicate";
  if (result === "WRONG_EVENT") return "tl-scan-duplicate";
  return "tl-scan-invalid";
}

export function ScannerClient({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"scan" | "search">("scan");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [activeEventName, setActiveEventName] = useState(eventName);
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
  const [overrideTicketId, setOverrideTicketId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const lastToken = useRef<string>("");

  useEffect(() => {
    setActiveEventName(eventName);
  }, [eventName]);

  function applyResolvedEvent(data: ScanResult) {
    if (
      data.resolvedEventId &&
      data.resolvedEventId !== eventId &&
      data.resolvedEventName
    ) {
      setActiveEventName(data.resolvedEventName);
      router.replace(`/scan?event=${data.resolvedEventId}`);
    }
  }

  // Refs, not state: the camera callback is registered once, so state read
  // inside it would be stale (busy was always false there).
  const busyRef = useRef(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  function feedback(ok: boolean) {
    try {
      navigator.vibrate?.(ok ? 80 : [60, 60, 160]);
    } catch {
      /* ignore */
    }
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioRef.current ??= new Ctx();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = ok ? 1320 : 220;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.09 : 0.3));
    } catch {
      /* ignore */
    }
  }

  function showResult(data: ScanResult) {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    setResult(data);
    feedback(data.result === "SUCCESS");
    // Valid tickets clear themselves so the next guest can step up; problems
    // stay until staff tap them away.
    if (data.result === "SUCCESS" && !data.ticket?.requireIdCheck && data.ticket?.ageLimit == null) {
      autoCloseRef.current = setTimeout(() => setResult(null), 1600);
    }
  }

  function errorMessage(data: unknown, fallback: string): string {
    const err = (data as { error?: unknown } | null)?.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const code = (err as { code?: string }).code;
      if (code === "FORBIDDEN") return "INGEN SCANNER-TILGANG TIL DETTE ARRANGEMENTET";
      if (code === "UNAUTHORIZED") return "LOGG INN PÅ NYTT";
      return String((err as { message: unknown }).message);
    }
    return fallback;
  }

  async function validateToken(raw: string) {
    const token = raw.trim();
    if (!token || busyRef.current || token === lastToken.current) return;
    lastToken.current = token;
    busyRef.current = true;
    setBusy(true);
    setResult({ result: "PENDING", message: "SJEKKER…" });
    try {
      // Extract token from URL if full verify URL was encoded
      const match = token.match(/\/t\/verify\/([^/?#]+)/);
      const secureToken = match?.[1] ?? token;

      const res = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: secureToken, eventId, deviceId: "web-scanner" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(data, "UGYLDIG BILLETT"));
      applyResolvedEvent(data);
      showResult(data);
    } catch (e) {
      showResult({
        result: "INVALID",
        message:
          e instanceof TypeError
            ? "INGEN NETT — PRØV IGJEN"
            : e instanceof Error
              ? e.message
              : "UGYLDIG BILLETT",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTimeout(() => {
        if (lastToken.current === token) lastToken.current = "";
      }, 2500);
    }
  }

  // Keep the serverless function and DB connection warm while the door is open,
  // so the first scan after a quiet spell is not a multi-second cold start.
  useEffect(() => {
    const ping = () =>
      void fetch("/api/tickets/check-in", { cache: "no-store" }).catch(() => undefined);
    ping();
    const id = setInterval(ping, 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // USB/Bluetooth QR scanners act as a keyboard: they "type" the code very
  // fast and end with Enter. Capture that anywhere on the page.
  useEffect(() => {
    let buf = "";
    let last = 0;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 80) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 8) {
          e.preventDefault();
          void validateToken(buf);
        }
        buf = "";
        return;
      }
      if (e.key.length === 1) buf += e.key;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (mode !== "scan") return;
    let cancelled = false;

    async function start() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode("qr-reader", {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          // Native BarcodeDetector (Chrome on Android) is many times faster than
          // the JS decoder; falls back automatically where unsupported.
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 20,
            disableFlip: true,
            qrbox: (w: number, h: number) => {
              const size = Math.floor(Math.min(w, h) * 0.75);
              return { width: size, height: size };
            },
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          (decoded) => {
            void validateToken(decoded);
          },
          () => undefined
        );
        if (cancelled) void scanner.stop().catch(() => undefined);
      } catch {
        if (!cancelled) {
          setCameraError("Kamera ikke tilgjengelig — bruk manuell søk, lim inn token eller en QR-leser.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      void scannerRef.current?.stop().catch(() => undefined);
      scannerRef.current = null;
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

  async function manualCheckIn(ticketId: string, opts?: { forceOverride?: boolean; note?: string }) {
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          eventId,
          deviceId: "web-scanner",
          forceOverride: opts?.forceOverride,
          note: opts?.note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showResult({ result: "INVALID", message: errorMessage(data, "UGYLDIG") });
        return;
      }
      applyResolvedEvent(data);
      showResult(data);
      setOverrideTicketId(null);
      setOverrideReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-md flex-col bg-[color:var(--background)] text-foreground sm:max-w-lg">
      <header className="border-b border-[color:var(--outline)]/30 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
            ● Station armed
          </p>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            Online
          </span>
        </div>
        <h1 className="mt-1 truncate font-display text-xl font-semibold">
          <span className="text-[color:var(--accent)]">●</span> {activeEventName}
        </h1>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="xl"
            className="h-14 text-base"
            variant={mode === "scan" ? "default" : "secondary"}
            onClick={() => setMode("scan")}
          >
            Scan QR
          </Button>
          <Button
            size="xl"
            className="h-14 text-base"
            variant={mode === "search" ? "default" : "secondary"}
            onClick={() => setMode("search")}
          >
            Manuelt søk
          </Button>
        </div>
      </header>

      <div className="flex-1 p-4 tl-safe-bottom">
        {mode === "scan" ? (
          <div>
            <div className="relative overflow-hidden rounded-xl border border-[color:var(--accent)]/40 bg-black shadow-[var(--shadow-panel)]">
              <div id="qr-reader" className="min-h-[min(52vh,22rem)]" />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-5 top-5 h-9 w-9 border-l-2 border-t-2 border-[color:var(--accent)]" />
                <div className="absolute right-5 top-5 h-9 w-9 border-r-2 border-t-2 border-[color:var(--accent)]" />
                <div className="absolute bottom-5 left-5 h-9 w-9 border-b-2 border-l-2 border-[color:var(--accent)]" />
                <div className="absolute bottom-5 right-5 h-9 w-9 border-b-2 border-r-2 border-[color:var(--accent)]" />
                <div className="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-[color:var(--accent)]/80" />
              </div>
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent-soft)]">
                ● Sentrer QR-kode
              </p>
            </div>
            {cameraError ? (
              <p className="mt-3 text-sm text-[color:var(--warning)]" role="status">
                {cameraError}
              </p>
            ) : null}
            <div className="mt-4">
              <Input
                placeholder="Lim inn token / URL"
                className="h-12 text-base"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const el = e.target as HTMLInputElement;
                    void validateToken(el.value);
                    el.value = "";
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
              className="h-12 text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
            />
            <Button className="h-14 w-full text-base" size="xl" onClick={search}>
              Søk gjest
            </Button>
            <ul className="space-y-2">
              {searchResults.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.holderName}</p>
                      <p className="text-xs text-[color:var(--muted)]">
                        {r.ticketType} · {r.publicId} · {r.status}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        size="sm"
                        className="min-h-10"
                        disabled={busy || r.status === "CHECKED_IN"}
                        onClick={() => void manualCheckIn(r.id)}
                      >
                        Check-in
                      </Button>
                      {r.status === "CHECKED_IN" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="min-h-10"
                          disabled={busy}
                          onClick={() => {
                            setOverrideTicketId(r.id);
                            setResult({
                              result: "ALREADY_USED",
                              message: "ALLEREDE BRUKT",
                              ticket: {
                                publicId: r.publicId,
                                holderName: r.holderName,
                                ticketType: r.ticketType,
                              },
                            });
                          }}
                        >
                          Override…
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {result ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={result.message}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto px-4 py-10 text-center animate-scale-in tl-safe-bottom sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-t-2xl",
            resultPanelClass(result.result)
          )}
          onClick={() => {
            if (result.result !== "PENDING") setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setResult(null);
          }}
        >
          <p className="font-display text-4xl font-bold tracking-wide sm:text-5xl">
            {result.message}
          </p>
          {result.result === "SUCCESS" && result.ticket ? (
            <div className="mx-auto mt-6 max-w-sm space-y-3 text-left text-base">
              {result.ticket.requireIdCheck || result.ticket.ageLimit != null ? (
                <div className="rounded-lg bg-black/25 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                    Alderskrav
                  </p>
                  <p className="text-2xl font-semibold">
                    {result.ticket.ageLimit != null ? `${result.ticket.ageLimit}+` : "—"}
                  </p>
                  <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-amber-100">
                    KONTROLLER LEGITIMASJON
                  </p>
                </div>
              ) : null}
              <p className="text-lg">
                <span className="opacity-70">Navn:</span>{" "}
                <span className="font-semibold">{result.ticket.holderName ?? "—"}</span>
              </p>
              <p>
                <span className="opacity-70">Billettype:</span> {result.ticket.ticketType}
              </p>
              {result.ticket.accessNote ? (
                <p>
                  <span className="opacity-70">Sone / merknad:</span> {result.ticket.accessNote}
                </p>
              ) : null}
            </div>
          ) : null}
          {result.result === "ALREADY_USED" ? (
            <div className="mx-auto mt-4 max-w-sm space-y-2 text-left text-base opacity-95">
              <p>
                Tidligere skannet{" "}
                {formatEventTime(
                  result.previousCheckInAt ??
                    result.ticket?.checkedInAt ??
                    new Date().toISOString(),
                  "Europe/Oslo"
                )}
              </p>
              {result.previousDeviceId || result.previousCheckedInByName ? (
                <p className="opacity-90">
                  Forrige scanner: {result.previousCheckedInByName ?? "—"}
                  {result.previousDeviceId ? ` · ${result.previousDeviceId}` : ""}
                </p>
              ) : null}
              {overrideTicketId ? (
                <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Begrunnelse for override (påkrevd)"
                    className="h-12 bg-white text-zinc-900"
                  />
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={busy || overrideReason.trim().length < 3}
                    onClick={() =>
                      void manualCheckIn(overrideTicketId, {
                        forceOverride: true,
                        note: overrideReason.trim(),
                      })
                    }
                  >
                    Bekreft override
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {result.result !== "SUCCESS" && result.ticket?.holderName ? (
            <p className="mt-4 text-lg font-medium opacity-90">{result.ticket.holderName}</p>
          ) : null}
          {result.result !== "PENDING" ? (
            <p className="mt-6 text-sm opacity-80">Trykk for å scanne neste</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
