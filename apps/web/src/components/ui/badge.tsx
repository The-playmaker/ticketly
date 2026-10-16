import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "danger" | "warning" | "muted";
}) {
  const variants = {
    default:
      "bg-[color:var(--accent)]/15 text-[color:var(--accent-soft)] border-[color:var(--accent)]/30",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    danger: "bg-red-500/15 text-red-300 border-red-500/30",
    warning: "bg-[color:var(--warning)]/15 text-[color:var(--warning)] border-[color:var(--warning)]/30",
    muted: "bg-[color:var(--surface-high)] text-[color:var(--muted)] border-[color:var(--outline)]/30",
  };
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
