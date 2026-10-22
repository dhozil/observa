"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WalletButton } from "@/components/wallet/wallet-button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/market", label: "Ledger" },
  { href: "/open", label: "Open a deal" },
  { href: "/#how", label: "How it works" },
];

function WatchMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
      <circle cx="12" cy="12" r="5.4" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      <path d="M12 12 18.4 7.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path
        d="M12 2.6v1.4M12 20v1.4M2.6 12h1.4M20 12h1.4"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.45"
      />
    </svg>
  );
}

function HeaderNav() {
  const [pathname, setPathname] = useState("");

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a");
      const href = anchor?.getAttribute("href");
      if (!href || /^(https?:|mailto:)/.test(href)) return;
      setPathname(href.split("#")[0] || "/");
    };
    sync();
    window.addEventListener("popstate", sync);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", sync);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <nav className="hidden items-center gap-7 md:flex">
      {LINKS.map((link) => {
        const base = link.href.replace("/#", "/");
        const active = link.href.includes("#")
          ? false
          : pathname === base || pathname.startsWith(`${base}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-active={active}
            className={cn(
              "link-line font-mono text-[0.62rem] uppercase tracking-[0.16em] transition-colors duration-300",
              active ? "text-mist" : "text-muted hover:text-mist",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-void/55 backdrop-blur-[6px]">
      <div className="mx-auto flex h-[68px] max-w-[1360px] items-center justify-between gap-6 px-5">
        <Link href="/" className="group flex items-center gap-3">
          <WatchMark className="size-6 text-signal transition-transform duration-700 group-hover:rotate-45" />
          <span className="flex items-baseline gap-2.5">
            <span className="font-display text-[1.6rem] leading-none tracking-[-0.01em]">
              Observa
            </span>
            <span className="hidden font-mono text-[0.52rem] uppercase tracking-[0.24em] text-muted sm:inline">
              Uptime escrow
            </span>
          </span>
        </Link>

        <HeaderNav />

        <div className="flex items-center gap-4">
          <span className="hidden items-center gap-2 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-muted lg:flex">
            <span className="signal-dot size-1.5 rounded-full bg-signal" />
            Studionet · 61999
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
