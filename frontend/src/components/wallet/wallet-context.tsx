"use client";

import * as React from "react";
import {
  ensureChain,
  getChainId,
  makeReadClient,
  makeWriteClient,
  requestAccounts,
  CHAIN_ID,
  type GenLayer,
} from "@/lib/genlayer";
import {
  subscribeWallets,
  type Eip6963ProviderDetail,
  type Eip1193Provider,
} from "@/lib/eip6963";

const STORAGE_KEY = "observa.wallet.rdns";

interface WalletState {
  /** Every wallet that announced itself over EIP-6963. */
  wallets: Eip6963ProviderDetail[];
  /** The wallet the user chose, if any. */
  selected: Eip6963ProviderDetail | null;
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  /** Read-only client — always available, no wallet needed. */
  read: GenLayer;
  /** Signing client — only once an address is connected. */
  write: GenLayer | null;
  onCorrectChain: boolean;
  connect: (detail: Eip6963ProviderDetail) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  clearError: () => void;
}

const WalletContext = React.createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const read = React.useMemo(() => makeReadClient(), []);
  const [wallets, setWallets] = React.useState<Eip6963ProviderDetail[]>([]);
  const [selected, setSelected] = React.useState<Eip6963ProviderDetail | null>(null);
  const [address, setAddress] = React.useState<string | null>(null);
  const [chainId, setChainId] = React.useState<number | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Discover wallets, deduped by uuid (wallets may announce repeatedly).
  React.useEffect(() => {
    return subscribeWallets((detail) => {
      setWallets((current) =>
        current.some((w) => w.info.uuid === detail.info.uuid) ? current : [...current, detail],
      );
    });
  }, []);

  const bind = React.useCallback((detail: Eip6963ProviderDetail) => {
    setSelected(detail);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, detail.info.rdns);
    }
    const provider = detail.provider;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts?.[0] ?? null);
      if (!accounts?.length) setSelected(null);
    };
    const onChain = (...args: unknown[]) => {
      const id = args[0] as string;
      setChainId(id ? Number.parseInt(id, 16) : null);
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
  }, []);

  const connect = React.useCallback(
    async (detail: Eip6963ProviderDetail) => {
      setConnecting(true);
      setError(null);
      try {
        await ensureChain(detail.provider);
        const accounts = await requestAccounts(detail.provider);
        if (!accounts.length) throw new Error("No account was shared.");
        setAddress(accounts[0]);
        setChainId(await getChainId(detail.provider));
        bind(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setConnecting(false);
      }
    },
    [bind],
  );

  const disconnect = React.useCallback(() => {
    setAddress(null);
    setSelected(null);
    setChainId(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const switchChain = React.useCallback(async () => {
    if (!selected) return;
    setError(null);
    try {
      await ensureChain(selected.provider);
      setChainId(await getChainId(selected.provider));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  // Silent reconnect: if a wallet we used before is present, ask it (no prompt)
  // for its current account so a reload keeps the session when it is still live.
  React.useEffect(() => {
    if (typeof window === "undefined" || selected) return;
    const preferred = window.localStorage.getItem(STORAGE_KEY);
    if (!preferred) return;
    const detail = wallets.find((w) => w.info.rdns === preferred);
    if (!detail) return;
    let cancelled = false;
    (async () => {
      try {
        const accounts = (await detail.provider.request({
          method: "eth_accounts",
        })) as string[];
        if (cancelled || !accounts?.length) return;
        setAddress(accounts[0]);
        setChainId(await getChainId(detail.provider));
        bind(detail);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, selected, bind]);

  const write = React.useMemo(
    () =>
      address && selected
        ? makeWriteClient(address, selected.provider as Eip1193Provider)
        : null,
    [address, selected],
  );

  const value: WalletState = {
    wallets,
    selected,
    address,
    chainId,
    connecting,
    error,
    read,
    write,
    onCorrectChain: chainId === CHAIN_ID,
    connect,
    disconnect,
    switchChain,
    clearError: () => setError(null),
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const context = React.useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
}
