/**
 * EIP-6963 multi-wallet discovery.
 *
 * MetaMask and Rabby both inject `window.ethereum` and race to own it, so
 * reading `window.ethereum` is non-deterministic. EIP-6963 has each wallet
 * announce itself with its own provider object, which lets us show a chooser and
 * drive exactly the wallet the user picked — no fighting over global control.
 */

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

interface AnnounceEvent extends Event {
  detail: Eip6963ProviderDetail;
}

/** Subscribe to wallet announcements. Returns an unsubscribe function. */
export function subscribeWallets(onFound: (detail: Eip6963ProviderDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as AnnounceEvent).detail;
    if (detail?.info?.uuid && detail.provider) onFound(detail);
  };
  window.addEventListener("eip6963:announceProvider", handler);
  // Re-broadcast the request so wallets that announced before we mounted reply.
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", handler);
}
