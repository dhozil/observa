"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, LogOut, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useWallet } from "@/components/wallet/wallet-context";
import { shortAddress } from "@/lib/format";
import { CHAIN_ID } from "@/lib/genlayer";

export function WalletButton() {
  const {
    address,
    chainId,
    onCorrectChain,
    connect,
    disconnect,
    switchChain,
    connecting,
    error,
    clearError,
  } = useWallet();
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  if (!address) {
    return (
      <>
        <Button onClick={() => setChooserOpen(true)}>
          <Wallet /> Connect wallet
        </Button>
        <Dialog
          open={chooserOpen}
          onClose={() => setChooserOpen(false)}
          title="Choose a wallet"
          description="Each wallet announces itself directly over EIP-6963. The one you pick here is the one that signs — no extension can override it."
        >
          <WalletChooser
            onPick={async (detail) => {
              await connect(detail);
              setChooserOpen(false);
            }}
            connecting={connecting}
            error={error}
            clearError={clearError}
          />
        </Dialog>
      </>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((value) => !value)}
        className="flex h-9 items-center gap-2 rounded-sm border border-line bg-panel-2 px-3 text-sm text-mist transition-colors hover:border-signal"
      >
        <span
          className={
            onCorrectChain ? "signal-dot size-2 rounded-full bg-signal" : "size-2 rounded-full bg-loss"
          }
          aria-hidden
        />
        <span className="font-mono text-xs">{shortAddress(address)}</span>
        <ChevronDown className="size-3.5 text-muted" />
      </button>

      {menuOpen ? (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 z-40 mt-2 w-64 rounded-md border border-line bg-panel p-2 shadow-2xl">
            <div className="px-2 py-1.5">
              <p className="text-xs uppercase tracking-wider text-muted">Network</p>
              <p className="mt-1 text-sm">
                {onCorrectChain ? (
                  <span className="text-signal">Genlayer Studio Network</span>
                ) : (
                  <span className="text-loss">Wrong network (chain {chainId ?? "?"})</span>
                )}
              </p>
              <p className="mt-0.5 font-mono text-[0.68rem] text-muted">chain id {CHAIN_ID}</p>
            </div>

            {!onCorrectChain ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                onClick={async () => {
                  await switchChain();
                  setMenuOpen(false);
                }}
              >
                <RefreshCw /> Switch to Studionet
              </Button>
            ) : null}

            <button
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-mist"
            >
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function WalletChooser({
  onPick,
  connecting,
  error,
  clearError,
}: {
  onPick: (detail: ReturnType<typeof useWallet>["wallets"][number]) => void | Promise<void>;
  connecting: boolean;
  error: string | null;
  clearError: () => void;
}) {
  const { wallets } = useWallet();

  if (error) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-loss">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
        <Button variant="secondary" size="sm" onClick={clearError}>
          Try again
        </Button>
      </div>
    );
  }

  if (!wallets.length) {
    return (
      <div className="space-y-3 text-sm text-muted">
        <p>No wallet detected.</p>
        <p>
          Install{" "}
          <a
            className="text-signal underline"
            href="https://metamask.io"
            target="_blank"
            rel="noreferrer"
          >
            MetaMask
          </a>{" "}
          or{" "}
          <a
            className="text-signal underline"
            href="https://rabby.io"
            target="_blank"
            rel="noreferrer"
          >
            Rabby
          </a>
          , then reopen this dialog.
        </p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {wallets.map((detail) => (
        <button
          key={detail.info.uuid}
          disabled={connecting}
          onClick={() => onPick(detail)}
          className="flex w-full items-center gap-3 rounded-sm border border-line-soft bg-panel-2 px-3 py-3 text-left transition-colors hover:border-signal disabled:opacity-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={detail.info.icon} alt="" className="size-7 rounded-sm" />
          <span className="flex-1">
            <span className="block text-sm text-mist">{detail.info.name}</span>
            <span className="block font-mono text-[0.68rem] text-muted">{detail.info.rdns}</span>
          </span>
          <span className="text-xs text-signal">{connecting ? "Connecting…" : "Connect"}</span>
        </button>
      ))}
    </div>
  );
}
