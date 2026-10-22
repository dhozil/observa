"use client";

import { useStats } from "@/hooks/use-contract";
import { formatGen } from "@/lib/format";
import { isConfigured } from "@/lib/observa";
import { cn } from "@/lib/utils";

export function StatsBand({ refreshMs = 20000 }: { refreshMs?: number }) {
  const { data, error } = useStats(refreshMs);

  const cells = [
    { label: "Deals observed", value: data ? String(data.deals) : "—", unit: "" },
    { label: "Escrow held", value: data ? formatGen(data.held_atto) : "—", unit: "GEN" },
    {
      label: "Released",
      value: data ? formatGen(data.total_released_atto) : "—",
      unit: "GEN",
    },
    {
      label: "Refunded",
      value: data ? formatGen(data.total_refunded_atto) : "—",
      unit: "GEN",
    },
  ];

  return (
    <section className="border-b border-line-soft">
      <div className="mx-auto max-w-[1360px] px-5">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {cells.map((cell, index) => (
            <div
              key={cell.label}
              className={cn(
                "border-line-soft px-4 py-7 first:pl-0 sm:border-t-0 sm:px-6",
                index % 2 === 1 && "border-l",
                index >= 2 && "border-t",
                index > 0 && "sm:border-l",
              )}
            >
              <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted">
                <span className="mr-2 text-line">0{index + 1}</span>
                {cell.label}
              </p>
              <p className="mt-3 truncate font-display text-[2.35rem] leading-none text-mist tabular">
                {cell.value}
                {cell.unit ? (
                  <span className="ml-1.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted">
                    {cell.unit}
                  </span>
                ) : null}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-3 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-muted">
          <span>
            {!isConfigured
              ? "Contract address not configured"
              : error
                ? error
                : "Live from the contract"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-2",
              data?.conserved ? "text-signal" : "",
            )}
          >
            <span
              className={cn(
                "size-1 rounded-full",
                data?.conserved ? "bg-signal" : "bg-muted",
              )}
            />
            {data ? (data.conserved ? "Ledger conserved" : "Not conserved") : "Awaiting ledger"}
          </span>
        </div>
      </div>
    </section>
  );
}
