import { cn } from "@/lib/utils";

export function KpiStat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4 shadow-[var(--shadow-soft)] sm:p-5",
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[1.65rem]">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[color:var(--muted)]">{hint}</p> : null}
    </div>
  );
}
