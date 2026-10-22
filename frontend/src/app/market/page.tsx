"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { StatsBand } from "@/components/stats-band";
import { ConfigNotice } from "@/components/config-notice";
import { DealLedger } from "@/components/deal/deal-ledger";
import { Reveal } from "@/components/reveal";
import { Input } from "@/components/ui/field";
import { useDealIds, useDeals } from "@/hooks/use-contract";
import { cn } from "@/lib/utils";

const FILTERS = ["ALL", "OPEN", "ACTIVE", "RESOLVED", "FINALIZED"] as const;

export default function MarketPage() {
  const ids = useDealIds();
  const orderedIds = React.useMemo(() => (ids.data ?? []).slice().reverse(), [ids.data]);
  const deals = useDeals(orderedIds.length ? orderedIds : null, 20000);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("ALL");
  const [query, setQuery] = React.useState("");

  const visible = React.useMemo(() => {
    const rows = deals.data ?? [];
    const needle = query.trim().toLowerCase();
    return rows.filter((deal) => {
      if (filter === "RESOLVED" && !["RESOLVED", "APPEALED"].includes(deal.status)) {
        return false;
      }
      if (filter !== "ALL" && filter !== "RESOLVED" && deal.status !== filter) return false;
      if (!needle) return true;
      return (
        deal.id.toLowerCase().includes(needle) ||
        deal.service.toLowerCase().includes(needle) ||
        deal.endpoint.toLowerCase().includes(needle) ||
        deal.provider.toLowerCase().includes(needle)
      );
    });
  }, [deals.data, filter, query]);

  return (
    <>
      <StatsBand />

      <section className="mx-auto max-w-[1360px] px-5 py-14">
        <Reveal className="grid gap-8 border-b border-line pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow text-muted">The ledger</p>
            <h1 className="mt-4 font-display text-[clamp(2.7rem,5vw,4.3rem)] leading-[0.95] text-veil">
              Every watched window
            </h1>
            <p className="mt-4 max-w-xl text-[0.88rem] leading-relaxed text-mist-dim text-veil">
              Deals in every state, from an unfunded commitment to a finalized split.
              Coverage is best-effort: a slot nobody probes is simply unobserved, and
              the minimum coverage floor decides when probes speak for the deal.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search service, id, endpoint…"
              className="pl-6"
              aria-label="Search deals"
            />
          </div>
        </Reveal>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            {FILTERS.map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={cn(
                  "border-b pb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] transition-colors duration-300",
                  filter === item
                    ? "border-signal text-mist"
                    : "border-transparent text-muted hover:text-mist",
                )}
              >
                {item === "RESOLVED" ? "In appeal" : item}
              </button>
            ))}
          </div>
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.14em] text-muted tabular">
            {visible.length} / {deals.data?.length ?? 0} records
          </p>
        </div>

        <ConfigNotice className="mt-6 max-w-2xl" />

        {deals.loading && !deals.data ? (
          <div className="mt-7 border-t border-line">
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-line-soft py-5 md:grid-cols-[54px_1fr_116px_104px]"
              >
                <div className="h-3 w-24 animate-pulse bg-panel-3" />
                <div className="h-3 w-48 animate-pulse bg-panel-3" />
                <div className="hidden h-3 w-20 animate-pulse bg-panel-3 md:block" />
                <div className="hidden h-3 w-16 animate-pulse bg-panel-3 md:block" />
              </div>
            ))}
          </div>
        ) : deals.error ? (
          <p className="mt-7 border-l-2 border-loss bg-loss/[0.06] px-4 py-3 text-sm text-loss">
            {deals.error}
          </p>
        ) : visible.length === 0 ? (
          <div className="mt-7 border-t border-line py-16">
            <p className="font-display text-[2rem] leading-none">
              {(deals.data?.length ?? 0) === 0 ? "The record is empty." : "Nothing matches."}
            </p>
            <p className="mt-3 max-w-md text-[0.86rem] leading-relaxed text-muted">
              {(deals.data?.length ?? 0) === 0
                ? "Open the first deal to put a window on the ledger."
                : "Try another status, or clear the search to see every record."}
            </p>
          </div>
        ) : (
          <div className="mt-7">
            <DealLedger deals={visible} />
          </div>
        )}
      </section>
    </>
  );
}
