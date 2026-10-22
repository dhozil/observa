"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ProgressiveHero } from "@/components/ui/progressive-hero";
import { StatsBand } from "@/components/stats-band";
import { HowItWorks } from "@/components/how-it-works";
import { ConfigNotice } from "@/components/config-notice";
import { DealLedger } from "@/components/deal/deal-ledger";
import { Reveal } from "@/components/reveal";
import { buttonVariants } from "@/components/ui/button";
import { useDealIds, useDeals, useStats } from "@/hooks/use-contract";
import { formatGen } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const stats = useStats(20000);
  const ids = useDealIds();
  const recentIds = React.useMemo(
    () => (ids.data ?? []).slice(-4).reverse(),
    [ids.data],
  );
  const recent = useDeals(ids.data === null ? null : recentIds);

  return (
    <>
      <ProgressiveHero
        deals={stats.data?.deals}
        heldGen={stats.data ? formatGen(stats.data.held_atto) : undefined}
      />
      <StatsBand />
      <HowItWorks />

      <section className="mx-auto max-w-[1360px] px-5 py-20">
        <Reveal className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-5">
          <div>
            <p className="eyebrow text-muted">On the record</p>
            <h2 className="mt-4 font-display text-[clamp(2.1rem,3.4vw,3rem)] leading-none">
              The latest watched windows
            </h2>
          </div>
          <Link
            href="/market"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Full ledger <ArrowUpRight />
          </Link>
        </Reveal>

        <ConfigNotice className="mt-6 max-w-2xl" />

        {ids.error ?? recent.error ? (
          <p className="mt-7 border-l-2 border-loss bg-loss/[0.06] px-4 py-3 text-sm text-loss">
            {ids.error ?? recent.error}
          </p>
        ) : recent.loading && !recent.data ? (
          <div className="border-t border-line">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="flex items-center justify-between border-b border-line-soft py-5"
              >
                <div className="h-3 w-24 animate-pulse bg-panel-3" />
                <div className="h-3 w-40 animate-pulse bg-panel-3" />
                <div className="hidden h-3 w-20 animate-pulse bg-panel-3 sm:block" />
              </div>
            ))}
          </div>
        ) : recent.data && recent.data.length > 0 ? (
          <DealLedger deals={recent.data} />
        ) : (
          <div className="border-t border-line py-16">
            <p className="font-display text-[2rem] leading-none">The record is empty.</p>
            <p className="mt-3 max-w-md text-[0.86rem] leading-relaxed text-muted">
              Commit a service, fund the escrow, and start watching. The first
              observation puts a window on the ledger.
            </p>
            <Link
              href="/open"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-6")}
            >
              Open the first deal <ArrowUpRight />
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
