import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-none border px-1.5 py-0.5 font-mono text-[0.58rem] font-medium uppercase leading-4 tracking-[0.14em]",
  {
    variants: {
      tone: {
        neutral: "border-line text-muted",
        watch: "border-watch/45 bg-watch/10 text-watch-bright",
        signal: "border-signal/40 bg-signal/8 text-signal",
        loss: "border-loss/50 bg-loss/10 text-loss",
        mist: "border-mist/25 bg-mist/5 text-mist",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
