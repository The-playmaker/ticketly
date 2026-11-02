"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

type NavItem = { href: string; label: string };

export function AdminMobileNav({
  nav,
  platformNav,
  email,
}: {
  nav: NavItem[];
  platformNav: NavItem[];
  email?: string | null;
}) {
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

  return (
    <>
      <button
        type="button"
        className="tl-touch inline-flex items-center justify-center rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] text-[color:var(--muted)] hover:text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Lukk adminmeny" : "Åpne adminmeny"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
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
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Lukk meny"
            onClick={() => setOpen(false)}
          />
          <aside
            id={panelId}
            className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col border-r border-[color:var(--outline)]/35 bg-[color:var(--surface-low)] shadow-[var(--shadow-elevated)] animate-fade-up"
          >
            <div className="border-b border-[color:var(--outline)]/25 px-4 py-4">
              <p className="font-display text-sm font-semibold uppercase tracking-[0.14em]">
                Ticketly Admin
              </p>
              {email ? (
                <p className="mt-1 truncate text-xs text-[color:var(--muted)]">{email}</p>
              ) : null}
            </div>
            <nav className="flex-1 overflow-y-auto p-3 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-2.5 text-[color:var(--muted)] hover:bg-[color:var(--surface-high)] hover:text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              {platformNav.length > 0 ? (
                <div className="mt-3 border-t border-[color:var(--outline)]/20 pt-3">
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    Plattform
                  </p>
                  {platformNav.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-md px-3 py-2.5 text-[color:var(--accent-soft)] hover:bg-[color:var(--surface-high)]"
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </nav>
            <div className="space-y-2 border-t border-[color:var(--outline)]/25 p-3 tl-safe-bottom">
              <Link
                href="/scan"
                className="flex items-center justify-center rounded-md bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-[color:var(--accent-foreground)]"
                onClick={() => setOpen(false)}
              >
                Åpne dørskanner
              </Link>
              <Link
                href="/"
                className="block px-3 py-2 text-center text-xs text-[color:var(--muted)]"
                onClick={() => setOpen(false)}
              >
                ← Butikk
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
