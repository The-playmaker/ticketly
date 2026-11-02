import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-[color:var(--surface-high)] text-[color:var(--muted)] border-[color:var(--outline)]/30",
  accent: "bg-[color:var(--accent)]/15 text-[color:var(--accent-soft)] border-[color:var(--accent)]/30",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warning: "bg-[color:var(--warning)]/15 text-[color:var(--warning)] border-[color:var(--warning)]/30",
  danger: "bg-red-500/15 text-red-300 border-red-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
} as const;

export type StatusPillTone = keyof typeof tones;

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusPillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Map common domain statuses to visual tone (admin tables). */
export function statusTone(status: string): StatusPillTone {
  const s = status.toUpperCase();
  if (["PUBLISHED", "PAID", "CHECKED_IN", "ACTIVE", "SUCCESS", "VALID"].includes(s)) {
    return "success";
  }
  if (["DRAFT", "PENDING", "RESERVED", "PAUSED"].includes(s)) return "warning";
  if (
    ["CANCELLED", "CANCELED", "FAILED", "REFUNDED", "EXPIRED", "INVALID", "SOLD_OUT"].includes(s)
  ) {
    return "danger";
  }
  if (["PARTIALLY_REFUNDED", "REVIEW_REQUIRED"].includes(s)) return "info";
  return "neutral";
}
