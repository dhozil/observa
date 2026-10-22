import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border font-mono font-medium uppercase tracking-[0.12em] transition-colors duration-300 disabled:pointer-events-none disabled:opacity-40 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-mist bg-mist text-ink hover:border-paper hover:bg-paper",
        secondary:
          "border-line bg-panel-2/70 text-mist hover:border-mist/45 hover:bg-panel-2",
        outline: "border-line bg-transparent text-mist hover:border-signal hover:text-signal",
        ghost:
          "border-transparent bg-transparent text-muted hover:border-transparent hover:text-mist",
        danger:
          "border-loss/55 bg-loss/10 text-loss hover:border-loss hover:bg-loss/15",
        watch:
          "border-watch/55 bg-watch/10 text-watch-bright hover:border-watch hover:bg-watch/15",
      },
      size: {
        sm: "h-8 px-3 text-[0.62rem] [&_svg]:size-3.5",
        md: "h-10 px-4 text-[0.7rem] [&_svg]:size-4",
        lg: "h-12 px-6 text-[0.76rem] [&_svg]:size-4",
        icon: "h-9 w-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
