import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,filter,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:brightness-110 shadow-[0_1px_0_rgba(0,0,0,0.25)]",
        secondary:
          "bg-[color:var(--surface-high)] text-foreground hover:bg-[color:var(--surface-bright)] border border-[color:var(--outline)]/25",
        outline:
          "border border-[color:var(--outline)]/50 bg-transparent text-foreground hover:bg-[color:var(--surface-container)]",
        ghost: "hover:bg-[color:var(--surface-high)]/80 text-foreground",
        danger:
          "bg-[color:var(--destructive)] text-[color:var(--destructive-foreground)] hover:brightness-110",
        success:
          "bg-[color:var(--success)] text-[color:var(--success-foreground)] hover:brightness-110",
        link: "text-[color:var(--accent-soft)] underline-offset-4 hover:underline h-auto px-0 py-0",
      },
      size: {
        default: "h-10 min-h-10 px-4 py-2",
        sm: "h-8 min-h-8 rounded-md px-3 text-xs",
        lg: "h-12 min-h-12 rounded-md px-6 text-base",
        xl: "h-14 min-h-14 rounded-md px-8 text-base font-semibold",
        icon: "h-10 w-10 min-h-10 min-w-10",
        "icon-lg": "h-12 w-12 min-h-12 min-w-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
