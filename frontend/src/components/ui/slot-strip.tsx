import * as React from "react";
import { cn } from "@/lib/utils";
import type { MonitorLog } from "@/lib/observa";

export function SlotStrip({
  log,
  slots,
  className,
  highlight,
}: {
  log: MonitorLog;
  slots: number;
  className?: string;
  highlight?: number | null;
}) {
  const width = slots <= 24 ? 11 : slots <= 48 ? 8 : slots <= 120 ? 5 : 3;
  const height = slots <= 24 ? 32 : slots <= 48 ? 24 : slots <= 120 ? 18 : 13;

  return (
    <div
      className={cn("flex flex-wrap items-end gap-[3px]", className)}
      role="list"
      aria-label="Slot observations"
    >
      {Array.from({ length: slots }, (_, index) => {
        const record = log[index] ?? null;
        const isHighlighted = highlight === index;
        const state = record ? (record.s === "UP" ? "up" : "down") : "none";
        const barHeight =
          state === "up" ? height : state === "down" ? Math.round(height * 0.52) : Math.round(height * 0.2);
        return (
          <span
            key={index}
            role="listitem"
            title={
              record
                ? `slot ${index} · ${record.s} · HTTP ${record.http}`
                : `slot ${index} · unobserved`
            }
            style={{ width, height: barHeight }}
            className={cn(
              "block transition-[height,background-color] duration-500",
              state === "up" && "bg-signal/80",
              state === "down" && "bg-loss/85",
              state === "none" && "border border-line-soft bg-panel-3/40",
              isHighlighted && "outline outline-1 outline-offset-2 outline-watch",
            )}
          />
        );
      })}
    </div>
  );
}

export function SlotLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-1 bg-signal/80" /> up
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1 bg-loss/85" /> down
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1 w-1 border border-line-soft bg-panel-3/40" /> unobserved
      </span>
    </div>
  );
}
