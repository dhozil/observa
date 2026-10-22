import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/deal/status-badge";
import {
  coverageBps,
  probeCoverageAuthoritative,
  probeUptimeBps,
  type Deal,
} from "@/lib/observa";
import { bpsToPercent, formatGen } from "@/lib/format";
import { cn } from "@/lib/utils";

const GRID =
  "md:grid-cols-[54px_minmax(0,1.7fr)_116px_104px_88px_104px_20px] md:items-center md:gap-4";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function uptimeOf(deal: Deal): number | null {
  if (["RESOLVED", "APPEALED", "FINALIZED"].includes(deal.status)) return deal.uptime_bps;
  if (probeCoverageAuthoritative(deal)) return probeUptimeBps(deal);
  if (deal.attested) return deal.attested_bps;
  return null;
}

export function DealLedger({ deals }: { deals: Deal[] }) {
  return (
    <div className="border-t border-line">
      <div
        className={cn(
          "hidden border-b border-line-soft py-2.5 font-mono text-[0.53rem] uppercase tracking-[0.18em] text-muted md:grid",
          GRID,
        )}
      >
        <span>Id</span>
        <span>Service / endpoint</span>
        <span>Status</span>
        <span>Coverage</span>
        <span>Uptime</span>
        <span className="text-right">Escrow</span>
        <span />
      </div>

      {deals.map((deal, index) => {
        const coverage = coverageBps(deal);
        const uptime = uptimeOf(deal);
        const breached = uptime !== null && uptime < deal.uptime_target_bps;

        return (
          <Link
            key={deal.id}
            href={`/deal/${deal.id}`}
            className="group block animate-rise border-b border-line-soft py-4 transition-colors duration-300 hover:bg-mist/[0.025]"
            style={{ "--rise-delay": `${Math.min(index, 8) * 45}ms` } as CSSProperties}
          >
            <div className="md:hidden">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[0.68rem] text-muted">{deal.id}</span>
                <StatusBadge status={deal.status} />
              </div>
              <p className="mt-2.5 truncate font-display text-[1.3rem] leading-tight">
                {deal.service}
              </p>
              <p className="mt-0.5 truncate font-mono text-[0.58rem] text-muted">
                {hostOf(deal.endpoint)}
              </p>
              <div className="mt-3.5 flex items-center justify-between gap-3">
                <LedgerCell label="coverage" value={bpsToPercent(coverage)} />
                <LedgerCell
                  label="uptime"
                  value={uptime === null ? "—" : bpsToPercent(uptime)}
                  tone={uptime === null ? undefined : breached ? "loss" : "signal"}
                />
                <LedgerCell label="escrow" value={`${formatGen(deal.escrow_atto)} GEN`} />
                <ArrowUpRight className="size-4 shrink-0 text-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal" />
              </div>
            </div>

            <div className={cn("hidden md:grid", GRID)}>
              <span className="font-mono text-[0.68rem] text-muted transition-colors group-hover:text-signal">
                {deal.id}
              </span>

              <div className="min-w-0">
                <p className="truncate font-display text-[1.22rem] leading-tight">
                  {deal.service}
                </p>
                <p className="mt-0.5 truncate font-mono text-[0.58rem] text-muted">
                  {hostOf(deal.endpoint)}
                </p>
              </div>

              <StatusBadge status={deal.status} />

              <div className="flex items-center gap-2">
                <div className="h-0.5 w-12 bg-panel-3">
                  <div
                    className={cn(
                      "h-full",
                      coverage >= deal.min_coverage_bps ? "bg-signal/70" : "bg-watch/80",
                    )}
                    style={{ width: `${Math.min(100, coverage / 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[0.6rem] text-mist-dim tabular">
                  {bpsToPercent(coverage)}
                </span>
              </div>

              <span
                className={cn(
                  "font-mono text-[0.68rem] tabular",
                  uptime === null ? "text-muted" : breached ? "text-loss" : "text-signal",
                )}
              >
                {uptime === null ? "—" : bpsToPercent(uptime)}
              </span>

              <div className="text-right">
                <span className="font-display text-[1.22rem] leading-none tabular">
                  {formatGen(deal.escrow_atto)}
                </span>
                <span className="ml-1 font-mono text-[0.52rem] uppercase tracking-[0.1em] text-muted">
                  GEN
                </span>
              </div>

              <div className="flex items-center justify-end">
                <ArrowUpRight className="size-3.5 text-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function LedgerCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "signal" | "loss";
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-[0.66rem] tabular",
          tone === "signal" && "text-signal",
          tone === "loss" && "text-loss",
          !tone && "text-mist-dim",
        )}
      >
        {value}
      </p>
    </div>
  );
}
