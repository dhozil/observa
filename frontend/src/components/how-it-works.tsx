import { FileCheck2, Radio, Scale, Wallet } from "lucide-react";
import { Reveal } from "@/components/reveal";

const STEPS = [
  {
    icon: FileCheck2,
    title: "Commit the terms",
    body: "Service, HTTPS endpoint, window, cadence and target. The terms are canonicalised and hashed on-chain before any money moves.",
  },
  {
    icon: Wallet,
    title: "Fund the escrow",
    body: "The client locks GEN. The provider starts the window, fixing every slot from that transaction's timestamp.",
  },
  {
    icon: Radio,
    title: "Watch the window",
    body: "Anyone may probe an open slot. Validators fetch independently and agree on UP or DOWN. A monitor may attest a report bound to the deal, terms, window and a committed digest.",
  },
  {
    icon: Scale,
    title: "Settle, appeal, finalize",
    body: "Integer-only split. A tentative verdict opens a one-hour bonded appeal; evidence closes with the window, then finalize pays the standing verdict.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-line-soft">
      <div className="mx-auto max-w-[1360px] px-5 py-20 lg:py-24">
        <Reveal className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="h-fit lg:sticky lg:top-24">
            <p className="eyebrow text-muted">The watch</p>
            <h2 className="mt-5 max-w-md font-display text-[clamp(2.4rem,4vw,3.6rem)] leading-[0.98]">
              An SLA is only as good as its observation.
            </h2>
            <p className="mt-5 max-w-sm text-[0.9rem] leading-relaxed text-mist-dim">
              Observa has no cron and no wall clock. Every sample is a transaction,
              every verdict is a pure function of recorded evidence, and nobody has
              to be trusted to turn the crank.
            </p>
            <p className="mt-8 font-mono text-[0.56rem] uppercase tracking-[0.18em] text-muted">
              Protocol / four movements
            </p>
          </div>

          <ol className="border-t border-line">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="group grid gap-3 border-b border-line py-6 sm:grid-cols-[72px_1fr] sm:gap-6"
              >
                <span className="font-display text-[1.9rem] leading-none text-line transition-colors duration-500 group-hover:text-signal">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-[1.55rem] leading-tight">{step.title}</h3>
                    <step.icon className="size-4 shrink-0 text-muted transition-colors duration-500 group-hover:text-watch" />
                  </div>
                  <p className="mt-2 max-w-xl text-[0.82rem] leading-relaxed text-muted">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
