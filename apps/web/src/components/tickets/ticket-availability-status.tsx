import { cn } from "@/lib/utils";
import type { TicketAvailabilityPresentation } from "@/lib/tickets/ticket-availability";
import { Button } from "@/components/ui/button";

type Props = {
  status: TicketAvailabilityPresentation;
  /** Compact inline (per ticket row) vs block (panel / empty state). */
  variant?: "inline" | "block";
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/**
 * Shared customer-facing ticket sales / availability status.
 * Business states use neutral surfaces; error styling only for technical_error.
 */
export function TicketAvailabilityStatus({
  status,
  variant = "block",
  className,
  onRetry,
  retryLabel = "Prøv igjen",
}: Props) {
  if (status.kind === "available" || !status.heading) return null;

  const isError = status.tone === "error";

  if (variant === "inline") {
    return (
      <p
        className={cn(
          "text-xs leading-snug",
          isError ? "text-[color:var(--destructive)]" : "text-[color:var(--muted)]",
          className
        )}
        role={isError ? "alert" : "status"}
        data-availability-kind={status.kind}
      >
        <span className="font-medium text-[color:var(--foreground)]/90">{status.heading}</span>
        {status.description ? (
          <span className="mt-0.5 block text-[color:var(--muted)]">{status.description}</span>
        ) : null}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg px-4 py-3",
        isError
          ? "border border-[color:var(--destructive)]/35 bg-[color:var(--destructive)]/8"
          : "border border-[color:var(--outline)]/25 bg-[color:var(--surface-high)]/60",
        className
      )}
      role={isError ? "alert" : "status"}
      data-availability-kind={status.kind}
    >
      <p
        className={cn(
          "text-sm font-medium",
          isError ? "text-[color:var(--destructive)]" : "text-[color:var(--foreground)]"
        )}
      >
        {status.heading}
      </p>
      {status.description ? (
        <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">{status.description}</p>
      ) : null}
      {isError && onRetry ? (
        <div className="mt-3">
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
