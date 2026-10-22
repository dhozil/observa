"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TOTAL = 30;
const DOWN_AT = 17;

export function ProgressiveHero({
  deals,
  heldGen,
}: {
  deals?: number;
  heldGen?: string;
}) {
  const [revealed, setRevealed] = React.useState(TOTAL);
  const reduced = React.useRef(false);

  React.useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) return;
    setRevealed(0);
    const id = window.setInterval(() => {
      setRevealed((value) => (value >= TOTAL + 6 ? 0 : value + 1));
    }, 850);
    return () => window.clearInterval(id);
  }, []);

  const cells = Array.from({ length: TOTAL }, (_, index) => {
    if (index >= revealed) return null;
    if (index === DOWN_AT) return "DOWN" as const;
    return "UP" as const;
  });
  const observed = cells.filter(Boolean).length;
  const up = cells.filter((cell) => cell === "UP").length;
  const coverage = Math.round((observed / TOTAL) * 100);
  const uptime = observed ? (up / observed) * 100 : 0;
  const met = uptime >= 95;

  return (
    <section className="relative">
      <div className="mx-auto max-w-[1360px] px-5">
        <div className="flex items-center justify-between gap-4 border-b border-line-soft py-3 font-mono text-[0.56rem] uppercase tracking-[0.18em] text-muted">
          <span>Field 01 — the observation window</span>
          <span className="hidden sm:inline">Intelligent contract · GenLayer</span>
          <span className="tabular">Studionet / 61999</span>
        </div>

        <div className="grid items-start gap-14 pb-20 pt-14 lg:grid-cols-[1.12fr_0.88fr] lg:gap-10 lg:pb-28 lg:pt-20">
          <div>
            <p className="eyebrow flex items-center gap-3 text-muted">
              <span className="h-px w-8 bg-line" aria-hidden />
              Agentic SLA escrow
            </p>

            <h1 className="mt-7 font-display text-[clamp(3.5rem,8vw,7rem)] tracking-[-0.035em]">
              <span className="block animate-rise">Uptime,</span>
              <span
                className="animate-rise block italic text-signal"
                style={{ "--rise-delay": "110ms" } as React.CSSProperties}
              >
                <span className="word-cycle">
                  <span className="word-cycle-track">
                    <span className="word-cycle-word word-cycle-word-1">watched.</span>
                    <span className="word-cycle-gap" aria-hidden />
                    <span className="word-cycle-word word-cycle-word-2">kept.</span>
                    <span className="word-cycle-gap" aria-hidden />
                    <span className="word-cycle-word word-cycle-word-3">settled.</span>
                    <span className="word-cycle-gap" aria-hidden />
                    <span className="word-cycle-word word-cycle-word-4" aria-hidden>
                      watched.
                    </span>
                  </span>
                </span>
              </span>
            </h1>

            <p
              className="animate-rise mt-8 max-w-lg text-balance text-[0.98rem] leading-[1.7] text-mist-dim"
              style={{ "--rise-delay": "210ms" } as React.CSSProperties}
            >
              A client escrows GEN against a provider&apos;s uptime promise. Validators
              probe the service on a fixed cadence, agree on every sample, and pay out
              from the record — no ticket queue, no trust fall.
            </p>

            <div
              className="animate-rise mt-9 flex flex-wrap items-center gap-3"
              style={{ "--rise-delay": "300ms" } as React.CSSProperties}
            >
              <Link href="/open" className={cn(buttonVariants({ size: "lg" }))}>
                Open a deal <ArrowUpRight />
              </Link>
              <Link
                href="/market"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Read the ledger
              </Link>
            </div>

            <div
              className="animate-rise mt-14 grid grid-cols-3 border-y border-line-soft"
              style={{ "--rise-delay": "380ms" } as React.CSSProperties}
            >
              <Spec index="01" title="Permissionless" note="anyone may probe" />
              <Spec index="02" title="Deterministic" note="integer-only split" />
              <Spec index="03" title="Bonded" note="appeals have skin" />
            </div>
          </div>

          <div
            className="animate-fade relative"
            style={{ "--fade-delay": "220ms" } as React.CSSProperties}
          >
            <div className="pointer-events-none absolute -inset-2 border border-line-soft/70" aria-hidden />
            <div className="relative border border-line bg-panel/90 p-5 backdrop-blur-[3px]">
              <span
                aria-hidden
                className="pointer-events-none absolute -left-px -top-px size-2.5 border-l border-t border-mist/40"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -right-px -top-px size-2.5 border-r border-t border-mist/40"
              />

              <div className="flex items-center justify-between border-b border-line-soft pb-3 font-mono text-[0.56rem] uppercase tracking-[0.18em]">
                <span className="text-muted">Observation window</span>
                <span className="inline-flex items-center gap-2 text-signal">
                  <span className="size-1.5 rounded-full bg-signal animate-blink" />
                  live
                </span>
              </div>

              <div className="mt-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-display text-[1.5rem] leading-none">acme-edge</p>
                  <p className="mt-2 truncate font-mono text-[0.58rem] text-muted">
                    api.acme.example/health
                  </p>
                </div>
                <Badge tone={met ? "signal" : "loss"}>
                  {observed === 0 ? "waiting" : met ? "within target" : "breach"}
                </Badge>
              </div>

              <div className="mt-7 flex items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-muted">
                    observed uptime
                  </p>
                  <p className="mt-1 font-display text-[3.6rem] leading-[0.85] text-mist tabular">
                    {observed === 0 ? "—" : uptime.toFixed(1)}
                    <span className="ml-1 font-sans text-[0.95rem] align-top text-muted">%</span>
                  </p>
                </div>
                <div className="pb-1 text-right">
                  <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-muted">
                    target
                  </p>
                  <p className="mt-1 font-mono text-sm text-signal">95.0%</p>
                </div>
              </div>

              <div className="relative mt-5 overflow-hidden border border-line-soft bg-void/55 p-3">
                <div className="pointer-events-none absolute inset-y-0 w-24 animate-sweep bg-gradient-to-r from-transparent via-signal/[0.06] to-transparent" />
                <div className="flex items-end gap-[3px]">
                  {cells.map((cell, index) => (
                    <span
                      key={index}
                      style={{
                        width: 10,
                        height: cell === "UP" ? 30 : cell === "DOWN" ? 16 : 6,
                      }}
                      className={cn(
                        "block transition-[height,background-color] duration-500",
                        cell === "UP" && "bg-signal/75",
                        cell === "DOWN" && "bg-loss/85",
                        cell === null && "border border-line-soft/80 bg-panel-3/40",
                      )}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between font-mono text-[0.56rem] uppercase tracking-[0.12em] text-muted">
                  <span>30 slots · 60s cadence</span>
                  <span className={met ? "text-signal" : "text-loss"}>
                    {observed === 0 ? "waiting" : met ? "in tolerance" : "breach"}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted">
                <span>coverage</span>
                <span className="text-mist-dim tabular">
                  {observed}/{TOTAL} · {coverage}%
                </span>
              </div>
              <div className="relative mt-2 h-1 bg-panel-3">
                <div
                  className="h-full bg-signal/70 transition-[width] duration-700"
                  style={{ width: `${coverage}%` }}
                />
                <span
                  className="absolute -top-1 h-3 w-px bg-watch"
                  style={{ left: "50%" }}
                  title="minimum coverage 50%"
                />
              </div>

              <div className="mt-5 grid grid-cols-3 border-t border-line-soft">
                <ConsoleCell label="target" value="95.0%" />
                <ConsoleCell
                  label="deals"
                  value={deals === undefined ? "—" : String(deals)}
                  divider
                />
                <ConsoleCell
                  label="escrow"
                  value={heldGen ?? "—"}
                  unit="GEN"
                  divider
                />
              </div>

              <p className="mt-4 font-mono text-[0.55rem] uppercase leading-relaxed tracking-[0.14em] text-muted">
                Every 60s · validators agree on UP/DOWN · one probe per slot
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Spec({ index, title, note }: { index: string; title: string; note: string }) {
  return (
    <div className="border-r border-line-soft px-4 py-4 last:border-r-0 first:pl-0">
      <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted">{index}</p>
      <p className="mt-2 font-display text-lg leading-none">{title}</p>
      <p className="mt-1.5 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-muted">
        {note}
      </p>
    </div>
  );
}

function ConsoleCell({
  label,
  value,
  unit,
  divider,
}: {
  label: string;
  value: string;
  unit?: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 py-3",
        divider && "border-l border-line-soft pl-4",
      )}
    >
      <p className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <p className="mt-1 truncate font-display text-[1.35rem] leading-none tabular">
        {value}
        {unit ? <span className="ml-1 font-mono text-[0.55rem] text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}
