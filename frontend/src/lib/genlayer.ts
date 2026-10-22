import { createClient, chains } from "genlayer-js";
import type { Eip1193Provider } from "./eip6963";

export const STUDIONET = chains.studionet;
export const CHAIN_ID = STUDIONET.id;
export const CHAIN_ID_HEX = `0x${STUDIONET.id.toString(16)}`;

export const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Genlayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

/**
 * In the browser we talk to our own `/api/rpc` route (same-origin) instead of
 * the RPC host directly, so the page never depends on the RPC's CORS headers.
 * In Node (tests, scripts) we go straight to the node.
 */
function clientChain() {
  if (typeof window === "undefined") return STUDIONET;
  return {
    ...STUDIONET,
    rpcUrls: { default: { http: [`${window.location.origin}/api/rpc`] } },
  };
}

/** The slice of the genlayer-js client this app actually uses. */
export interface GenLayer {
  readContract(args: {
    address: string;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;
  writeContract(args: {
    address: string;
    functionName: string;
    args?: unknown[];
    value: bigint;
    consensusMaxRotations?: number;
  }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: string;
    status?: string;
    interval?: number;
    retries?: number;
  }): Promise<ProtocolReceipt>;
  getBalance(args: { address: string }): Promise<bigint>;
}

export interface LeaderReceipt {
  execution_result?: string;
  error_code?: string;
  result?: { status?: string; payload?: unknown };
}

export interface ProtocolReceipt {
  hash?: string;
  transaction_hash?: string;
  status?: string;
  consensus_data?: { leader_receipt?: LeaderReceipt[] };
  contract_address?: string;
  to_address?: string;
  txDataDecoded?: { contractAddress?: string };
}

/** A read-only client; no account, reads straight from the node. */
export function makeReadClient(): GenLayer {
  return createClient({ chain: clientChain() }) as unknown as GenLayer;
}

/**
 * A signing client bound to one wallet.
 *
 * Both `account` (an address string) and `provider` are required for genlayer-js
 * to route signing through the injected provider rather than a local key. The
 * provider is the one the user picked in the EIP-6963 chooser, so this never
 * touches `window.ethereum`.
 */
export function makeWriteClient(address: string, provider: Eip1193Provider): GenLayer {
  return createClient({
    chain: clientChain(),
    account: address,
    provider,
  } as never) as unknown as GenLayer;
}

export async function getChainId(provider: Eip1193Provider): Promise<number | null> {
  try {
    const id = (await provider.request({ method: "eth_chainId" })) as string;
    return id ? Number.parseInt(id, 16) : null;
  } catch {
    return null;
  }
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  return accounts ?? [];
}

/** Add/switch the wallet to Studionet. Mirrors what genlayer-js does, but on our provider. */
export async function ensureChain(provider: Eip1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current && current.toLowerCase() === CHAIN_ID_HEX.toLowerCase()) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    // 4902: unknown chain. Some wallets report it as -32603.
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [CHAIN_PARAMS],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
      return;
    }
    throw error;
  }
}
