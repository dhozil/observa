import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-none border border-line bg-void/45 px-3 py-2 text-sm text-mist placeholder:text-muted/60 transition-colors focus:border-signal focus:outline-none disabled:opacity-50";

const lineBase =
  "w-full rounded-none border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-mist placeholder:text-muted/50 transition-colors focus:border-signal focus:outline-none focus:ring-0 disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(lineBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        lineBase,
        "h-10 cursor-pointer appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4.5 6 8.5l4-4' fill='none' stroke='%238b8f86' stroke-width='1.2'/%3E%3C/svg%3E\")] bg-[right_0.15rem_center] bg-no-repeat pr-6",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "mb-1.5 block font-mono text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
