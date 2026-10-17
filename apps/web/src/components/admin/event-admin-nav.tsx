"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { suffix: "", label: "Oversikt" },
  { suffix: "/orders", label: "Ordrer" },
  { suffix: "/attendees", label: "Deltakere" },
  { suffix: "/waitlist", label: "Venteliste" },
  { suffix: "/analytics", label: "Analyse" },
  { suffix: "/security", label: "Sikkerhet" },
  { suffix: "/settings", label: "Innstillinger" },
] as const;

export function EventAdminNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const base = `/admin/events/${eventId}`;

  return (
    <nav
      className="flex flex-wrap gap-1 border-b border-zinc-200 pb-3 text-sm"
      aria-label="Event admin"
    >
      {links.map((l) => {
        const href = `${base}${l.suffix}`;
        const isActive =
          l.suffix === ""
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(href);
        return (
          <Link
            key={l.suffix || "overview"}
            href={href}
            className={`min-h-11 rounded-md px-3 py-2 ${
              isActive
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
