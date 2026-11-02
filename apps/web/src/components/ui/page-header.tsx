import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="tl-eyebrow">{eyebrow}</p> : null}
        <h1
          className={cn(
            "font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl",
            eyebrow && "mt-1"
          )}
        >
          {title}
        </h1>
        {description ? (
          <div className="mt-1.5 text-sm leading-relaxed text-[color:var(--muted)]">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
