import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-line-soft">
      <div className="mx-auto grid max-w-[1360px] gap-10 px-5 py-16 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <p className="font-display text-4xl leading-none">Observa</p>
          <p className="mt-4 max-w-sm text-[0.86rem] leading-relaxed text-mist-dim">
            An intelligent contract that watches an uptime promise and keeps the escrow
            honest. Deterministic settlement, permissionless probes, bonded appeals.
          </p>
          <p className="mt-6 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
            observare · to watch · to keep
          </p>
        </div>

        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
            The protocol
          </p>
          <ul className="mt-4 space-y-2.5 text-[0.86rem] text-mist-dim">
            <li>
              <Link href="/market" className="link-line transition-colors hover:text-signal">
                The ledger
              </Link>
            </li>
            <li>
              <Link href="/open" className="link-line transition-colors hover:text-signal">
                Open a deal
              </Link>
            </li>
            <li>
              <Link href="/#how" className="link-line transition-colors hover:text-signal">
                How it works
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
            Built on
          </p>
          <ul className="mt-4 space-y-2.5 text-[0.86rem] text-mist-dim">
            <li>
              <a
                href="https://docs.genlayer.com"
                target="_blank"
                rel="noreferrer"
                className="link-line transition-colors hover:text-signal"
              >
                GenLayer docs
              </a>
            </li>
            <li className="font-mono text-[0.7rem] text-muted">Studionet · chain 61999</li>
            <li className="font-mono text-[0.7rem] text-muted">GEN · 18 decimals</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-2 px-5 py-5 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
          <span>No cron. No wall clock. Tx-triggered only.</span>
          <span>Observa / GenLayer</span>
        </div>
      </div>
    </footer>
  );
}
