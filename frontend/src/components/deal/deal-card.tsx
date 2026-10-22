import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/deal/status-badge";
import {
  OUTCOME_TONE,
  coverageBps,
  type Deal,
} from "@/lib/observa";
import { bpsToPercent, formatGen, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function DealCard({ deal }: { deal: Deal }) {
  const coverage = coverageBps(deal);
  const observed = deal.status === "ACTIVE" || deal.status === "RESOLVED" || deal.status === "APPEALED";

  return (
    <Link href={`/deal/${deal.id}`} className="group block h-full">
      <Card className="flex h-full flex-col transition-colors group-hover:border-signal/40">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-muted">
                {deal.id}
              </p>
              <h3 className="mt-1 truncate text-lg leading-tight">{deal.service}</h3>
              <p className="mt-1 truncate font-mono text-[0.66rem] text-muted">
                {hostOf(deal.endpoint)}
              </p>
            </div>
            <StatusBadge status={deal.status} />
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
                escrow
              </p>
              <p className="mt-1 font-mono text-lg text-mist">
                {formatGen(deal.escrow_atto)}{" "}
                <span className="text-[0.66rem] text-muted">GEN</span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
                target
              </p>
              <p className="mt-1 font-mono text-sm text-signal">
                {bpsToPercent(deal.uptime_target_bps)}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between font-mono text-[0.64rem] text-muted">
              <span>probe coverage</span>
              <span className={coverage >= deal.min_coverage_bps ? "text-signal" : ""}>
                {coverage}% · {deal.probed_slots}/{deal.slots}
              </span>
            </div>
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700",
                  coverage >= deal.min_coverage_bps ? "bg-signal/80" : "bg-watch/80",
                )}
                style={{ width: `${coverage}%` }}
              />
              <span
                className="absolute top-0 h-full w-px bg-mist/50"
                style={{ left: `${deal.min_coverage_bps / 100}%` }}
              />
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
            <div className="flex items-center gap-2">
              {observed && deal.outcome ? (
                <Badge tone={OUTCOME_TONE[deal.outcome] ?? "neutral"}>{deal.outcome}</Badge>
              ) : (
                <span className="font-mono text-[0.66rem] text-muted">
                  {deal.attested ? "attested" : "probe-only"}
                </span>
              )}
              {deal.attestation_url ? (
                <span className="font-mono text-[0.66rem] text-muted">· monitor</span>
              ) : null}
            </div>
            <span className="inline-flex items-center gap-1 font-mono text-[0.66rem] text-muted transition-colors group-hover:text-signal">
              {shortAddress(deal.provider)} <ArrowUpRight className="size-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
