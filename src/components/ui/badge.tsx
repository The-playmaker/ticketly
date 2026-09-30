import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "danger" | "warning" | "muted";
}) {
  const variants = {
    default: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    danger: "bg-red-500/15 text-red-300 border-red-500/30",
    warning: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    muted: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
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
