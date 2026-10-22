import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative rounded-none border border-line bg-panel/85 backdrop-blur-[3px]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -left-px -top-px size-2 border-l border-t border-mist/30"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-px -top-px size-2 border-r border-t border-mist/30"
      />
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-b border-line-soft px-5 pb-3.5 pt-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "flex items-center gap-2 font-mono text-[0.66rem] font-medium uppercase leading-5 tracking-[0.18em] text-mist-dim",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-1.5 text-[0.78rem] leading-relaxed text-muted", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-line-soft px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
