"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  isLoggedIn: boolean;
  hasStaffAccess: boolean;
  staffHome: string;
  staffLabel: string;
};

export function MobileNav({ isLoggedIn, hasStaffAccess, staffHome, staffLabel }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const linkClass =
    "block rounded-md px-3 py-3 text-base text-foreground hover:bg-[color:var(--surface-high)]";

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="tl-touch inline-flex items-center justify-center rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-container)] text-[color:var(--muted)] hover:text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Lukk meny" : "Åpne meny"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sr-only">Meny</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 top-16 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Lukk meny"
            onClick={() => setOpen(false)}
          />
          <nav
            id={panelId}
            className={cn(
              "absolute inset-x-0 top-0 animate-fade-up border-b border-[color:var(--outline)]/35 bg-[color:var(--surface-low)] px-3 py-3 shadow-[var(--shadow-elevated)]"
            )}
            aria-label="Mobilnavigasjon"
          >
            <Link href="/events" className={linkClass} onClick={() => setOpen(false)}>
              Arrangementer
            </Link>
            <Link
              href="/login?callbackUrl=/admin"
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              For arrangører
            </Link>
            {isLoggedIn ? (
              <>
                <Link href="/my/tickets" className={linkClass} onClick={() => setOpen(false)}>
                  Mine billetter
                </Link>
                {hasStaffAccess ? (
                  <Link href={staffHome} className={linkClass} onClick={() => setOpen(false)}>
                    {staffLabel}
                  </Link>
                ) : null}
              </>
            ) : (
              <Link href="/login" className={linkClass} onClick={() => setOpen(false)}>
                Logg inn
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
