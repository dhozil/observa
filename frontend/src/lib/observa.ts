import type { GenLayer as Client, ProtocolReceipt } from "./genlayer";

/**
 * The deployed Observa instance this app talks to. The address is env-driven so
 * the UI can degrade to a setup notice instead of pretending to read a contract.
 */
export const ADDRESS = (process.env.NEXT_PUBLIC_OBSERVA_ADDRESS ?? "").trim();
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const isConfigured =
  /^0x[0-9a-fA-F]{40}$/.test(ADDRESS) && ADDRESS.toLowerCase() !== ZERO_ADDRESS;

// ---------------------------------------------------------------- data shapes

export type ProbeStatus = "UP" | "DOWN";

export interface ProbeRecord {
  s: ProbeStatus;
  http: number;
}

export type MonitorLog = (ProbeRecord | null)[];

export interface Deal {
  id: string;
  client: string;
  provider: string;
  service: string;
  endpoint: string;
  terms_digest: string;
  window_seconds: number;
  slots: number;
  slot_seconds: number;
  uptime_target_bps: number;
  min_coverage_bps: number;
  monitor: string;
  attestation_url: string;
  escrow_atto: string;
  status: string;
  started_at_unix: number;
  end_unix: number;
  probed_slots: number;
  up_slots: number;
  attested: boolean;
  attested_bps: number;
  uptime_bps: number;
  release_bps: number;
  first_release_bps: number;
  outcome: string;
  settled: boolean;
  paid_atto: string;
  resolved_at_unix: number;
  appeal_deadline_unix: number;
  appellant: string;
  appeal_bond_atto: string;
  appeal_decided: boolean;
  appeal_evidence_unavailable: boolean;
  final: boolean;
}

export interface DealTerms {
  service: string;
  endpoint: string;
  window_seconds: number;
  slots: number;
  uptime_target_bps: number;
  min_coverage_bps?: number;
  expect_status?: number;
  monitor?: string;
  attestation_url?: string;
  [key: string]: unknown;
}

export interface DealAudit {
  id: string;
  status: string;
  outcome: string;
  uptime_bps: number;
  measured_bps: number;
  release_bps: number;
  probed_slots: number;
  up_slots: number;
  attested: boolean;
  attested_bps: number;
  attested_digest: string;
  attestation_nonce: string;
  monitor: string;
  paid_atto: string;
  first_release_bps: number;
  resolved_at_unix: number;
  appellant: string;
  appeal_bond_atto: string;
  appeal_decided: boolean;
  appeal_evidence_unavailable: boolean;
  final: boolean;
}

export type PayoutState = "owed" | "sent" | "delivered";

export interface PayoutRow {
  deal_id: string;
  kind: "provider" | "client" | "bond";
  recipient: string;
  amount_atto: string;
  memo: string;
  state: PayoutState;
  attempts: number;
  sent_at_unix: number;
  balance_at_emit: string;
  inflow_at_emit: string;
  returned_atto: string;
  delivered_at_unix: number;
}

export interface PayoutInfo {
  payouts: PayoutRow[];
  contract_balance_atto: string;
  grace_seconds: number;
  in_flight: string;
  total_returned_atto: string;
}

export interface Stats {
  deals: number;
  held_atto: string;
  lifetime_inflow_atto: string;
  lifetime_outflow_atto: string;
  total_released_atto: string;
  total_refunded_atto: string;
  owed_atto: string;
  in_flight_atto: string;
  pending_payouts: number;
  unreconciled_payouts: number;
  total_returned_atto: string;
  conserved: boolean;
  log_truncated: boolean;
}

export interface Config {
  max_slots: number;
  probe_grace_sec: number;
  lapse_grace_sec: number;
  default_min_coverage_bps: number;
  min_escrow_atto: number;
  appeal_window_sec: number;
  appeal_bond_bps: number;
  min_appeal_bond_atto: number;
  payout_grace_sec: number;
  equivalence: Record<string, unknown>;
}

export interface LogEntry {
  event: string;
  id?: string;
  [key: string]: unknown;
}

// --------------------------------------------------------------- status model

export const STATUS = {
  OPEN: "OPEN",
  FUNDED: "FUNDED",
  ACTIVE: "ACTIVE",
  RESOLVED: "RESOLVED",
  APPEALED: "APPEALED",
  FINALIZED: "FINALIZED",
  REFUNDED: "REFUNDED",
} as const;

export type Tone = "neutral" | "watch" | "signal" | "loss" | "mist";

export const STATUS_TONE: Record<string, Tone> = {
  OPEN: "neutral",
  FUNDED: "watch",
  ACTIVE: "signal",
  RESOLVED: "watch",
  APPEALED: "loss",
  FINALIZED: "signal",
  REFUNDED: "mist",
};

export const STATUS_NOTE: Record<string, string> = {
  OPEN: "Terms committed. Waiting for the client to fund the escrow.",
  FUNDED: "Escrow locked. Waiting for the provider to start the window.",
  ACTIVE: "The monitoring window is open. Any wallet may probe a slot.",
  RESOLVED: "A tentative verdict exists. The appeal window is deciding whether it stands.",
  APPEALED: "A party staked a bond. The verdict will be re-derived from fresh evidence.",
  FINALIZED: "The verdict is final. Payout delivery is tracked separately.",
  REFUNDED: "The escrow is returning to the client. Delivery is tracked separately.",
};

export const OUTCOME_TONE: Record<string, Tone> = {
  MET: "signal",
  BREACHED: "loss",
};

export const OUTCOME_LABEL: Record<string, string> = {
  MET: "Met — the provider held the target",
  BREACHED: "Breached — the split follows measured uptime",
};

export const LIFECYCLE = ["OPEN", "FUNDED", "ACTIVE", "RESOLVED", "FINALIZED"] as const;

/** Protocol constants mirrored from contracts/observa.py. */
export const PROTOCOL = {
  maxSlots: 720,
  probeGraceSec: 300,
  lapseGraceSec: 86400,
  defaultMinCoverageBps: 5000,
  minEscrowAtto: 1n,
  appealWindowSec: 3600,
  appealBondBps: 2500,
  minAppealBondAtto: 10n ** 15n,
  payoutGraceSec: 3600,
  maxLog: 500,
} as const;

/** The minimum bond `appeal()` will accept for a given escrow. */
export function appealBondFor(escrowAtto: string | bigint): bigint {
  const escrow = BigInt(escrowAtto);
  const share = (escrow * BigInt(PROTOCOL.appealBondBps)) / 10000n;
  return share > PROTOCOL.minAppealBondAtto ? share : PROTOCOL.minAppealBondAtto;
}

export type Role = "client" | "provider" | "monitor" | "observer" | "disconnected";

export function roleOf(deal: Deal | null, address: string | null): Role {
  if (!deal) return "observer";
  if (!address) return "disconnected";
  const a = address.toLowerCase();
  if (deal.client.toLowerCase() === a) return "client";
  if (deal.provider.toLowerCase() === a) return "provider";
  if (deal.monitor && deal.monitor.toLowerCase() === a) return "monitor";
  return "observer";
}

export function roleOfLabel(role: Role): string {
  if (role === "client") return "You are the client";
  if (role === "provider") return "You are the provider";
  if (role === "monitor") return "You are the monitor";
  if (role === "disconnected") return "No wallet connected";
  return "Observer";
}

// ---------------------------------------------------------- observation maths

export function coverageBps(deal: Deal): number {
  if (!deal.slots) return 0;
  return Math.min(10000, Math.floor((10000 * deal.probed_slots) / deal.slots));
}

export function probeUptimeBps(deal: Deal): number {
  if (!deal.probed_slots) return 0;
  return Math.floor((10000 * deal.up_slots) / deal.probed_slots);
}

/** Probes decide only at or above the committed coverage floor. */
export function probeCoverageAuthoritative(deal: Deal): boolean {
  return deal.probed_slots > 0 && coverageBps(deal) >= deal.min_coverage_bps;
}

/** What the contract will read, without guessing a verdict before settlement. */
export function evidenceSource(
  deal: Deal,
): "probes" | "attestation" | "inconclusive" | "none" {
  if (probeCoverageAuthoritative(deal)) return "probes";
  if (deal.attested) return "attestation";
  if (deal.probed_slots > 0) return "inconclusive";
  return "none";
}

export function probeWindow(deal: Deal, index: number) {
  const start = deal.started_at_unix + index * deal.slot_seconds;
  const close = start + deal.slot_seconds + PROTOCOL.probeGraceSec;
  return { start, close };
}

/**
 * The slot a keeper could probe right now: the current slot, or the previous
 * one while it is still inside its grace. Returns null when nothing is open.
 */
export function nextProbeSlot(
  deal: Deal,
  log: MonitorLog,
  now: number,
): number | null {
  const monitoringOpen =
    deal.status === "ACTIVE" ||
    deal.status === "APPEALED" ||
    (deal.status === "RESOLVED" && !deal.final && now <= deal.appeal_deadline_unix);
  if (!monitoringOpen || !deal.slot_seconds) return null;
  const base = Math.floor((now - deal.started_at_unix) / deal.slot_seconds);
  for (const index of [base, base - 1]) {
    if (index < 0 || index >= deal.slots) continue;
    if (log[index]) continue;
    const { start, close } = probeWindow(deal, index);
    if (now >= start && now <= close) return index;
  }
  return null;
}

/** Authoritative evidence: settlement can use it without reverting. */
export function hasEvidence(deal: Deal): boolean {
  return probeCoverageAuthoritative(deal) || deal.attested;
}

export function isLapsed(deal: Deal, now: number): boolean {
  return (
    deal.status === "ACTIVE" &&
    !hasEvidence(deal) &&
    now > deal.end_unix + PROTOCOL.lapseGraceSec
  );
}

// ------------------------------------------------------------ rpc resilience

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Studionet allows ~30 requests per minute. A deal view needs several reads at
 * once, so pace browser reads below that ceiling instead of letting genlayer-js
 * discover it with 429s. Test/Node runs are not paced (they use their own rails).
 */
const READ_BUDGET = 24;
const READ_WINDOW_MS = 60_000;
const readStamps: number[] = [];
let readCooldownUntil = 0;

async function waitForReadBudget(): Promise<void> {
  if (typeof window === "undefined") return;
  for (;;) {
    const now = Date.now();
    if (readCooldownUntil > now) {
      await sleep(readCooldownUntil - now);
      continue;
    }
    while (readStamps.length > 0 && now - readStamps[0] >= READ_WINDOW_MS) {
      readStamps.shift();
    }
    if (readStamps.length < READ_BUDGET) {
      readStamps.push(now);
      return;
    }
    await sleep(readStamps[0] + READ_WINDOW_MS - now + 100);
  }
}

function cooldownReads(ms: number): void {
  if (typeof window === "undefined") return;
  readCooldownUntil = Math.max(readCooldownUntil, Date.now() + ms);
}

function rateLimitDelay(error: unknown): number {
  let raw = "";
  try {
    raw = JSON.stringify(error);
  } catch {
    raw = "";
  }
  const text = `${messageOf(error)} ${raw}`;
  if (!/rate limit|-32029|retry_after|too many requests/i.test(text)) return 0;
  const match = text.match(/retry_after_seconds["']?\s*[:=]\s*(\d+)/i);
  const seconds = match ? Number(match[1]) : 0;
  return Math.min(Math.max(seconds * 1_000, 4_000), 20_000);
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${error.message} ${cause?.message ?? ""}`.trim();
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isTransient(error: unknown): boolean {
  return /rate limit|unknown rpc error|unexpected token|DOCTYPE|bad gateway|service unavailable|gateway timeout|fetch failed|network error|ECONNRESET|socket hang up|\b50[234]\b|temporarily|-32029|retry_after/i.test(
    messageOf(error),
  );
}

function isReadRetryable(error: unknown): boolean {
  return (
    isTransient(error) ||
    /execution failed|invalid parameters|not found|not been finalized|not finalized|is pending|not ready|no such/i.test(
      messageOf(error),
    )
  );
}

// -------------------------------------------------------------- read helpers

async function readJson<T>(client: Client, functionName: string, args: unknown[] = []): Promise<T> {
  if (!isConfigured) {
    throw new Error(
      "Observa is not configured. Set NEXT_PUBLIC_OBSERVA_ADDRESS in frontend/.env.local.",
    );
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForReadBudget();
    try {
      const raw = await client.readContract({ address: ADDRESS, functionName, args });
      return JSON.parse(String(raw)) as T;
    } catch (error) {
      lastError = error;
      const rateDelay = rateLimitDelay(error);
      if (rateDelay > 0) {
        cooldownReads(rateDelay);
        if (attempt < 1) {
          await sleep(rateDelay);
          continue;
        }
        throw error;
      }
      if (!isReadRetryable(error)) throw error;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

export const getDealIds = (client: Client) => readJson<string[]>(client, "get_deal_ids");
export const getDealCount = (client: Client) => readJson<number>(client, "get_deal_count");
export const getDeal = (client: Client, id: string) => readJson<Deal>(client, "get_deal", [id]);
export const getTerms = (client: Client, id: string) =>
  readJson<DealTerms>(client, "get_terms", [id]);
export const getMonitorLog = (client: Client, id: string) =>
  readJson<MonitorLog>(client, "get_monitor_log", [id]);
export const getAudit = (client: Client, id: string) =>
  readJson<DealAudit>(client, "get_deal_audit", [id]);
export const getConfig = (client: Client) => readJson<Config>(client, "get_config");
export const getStats = (client: Client) => readJson<Stats>(client, "get_stats");
export const getPayouts = (client: Client, id: string) =>
  readJson<PayoutInfo>(client, "get_payouts", [id]);
export const getPendingPayouts = (client: Client) =>
  readJson<PayoutRow[]>(client, "get_pending_payouts");

export async function getDeals(client: Client, ids: string[]): Promise<Deal[]> {
  return Promise.all(ids.map((id) => getDeal(client, id)));
}

export async function getLog(client: Client, start = 0, count = 200): Promise<LogEntry[]> {
  const rows = await readJson<string[]>(client, "get_log", [start, count]);
  return rows.map((row) => {
    try {
      return JSON.parse(row) as LogEntry;
    } catch {
      return { event: String(row) };
    }
  });
}

// -------------------------------------------------------------- write helpers

export type WriteResult =
  | { ok: true; hash: string; receipt: ProtocolReceipt }
  | { ok: false; message: string; hash?: string };

export type TxPhase = "idle" | "signing" | "waiting" | "confirmed";
export type PhaseReporter = (phase: TxPhase) => void;

/**
 * Studionet reaches consensus in tens of seconds, sometimes minutes. Poll at 5s
 * (well under the node's ~30/min ceiling) and wait long enough that a slow but
 * honest round is never reported as a failure.
 */
export const CONSENSUS_WAIT = {
  intervalMs: 5000,
  retries: 120,
} as const;

function leaderFailure(receipt: ProtocolReceipt): string | null {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  if (!leader) return null;
  const status = leader.result?.status;
  if (leader.execution_result === "SUCCESS" && (status === undefined || status === "return")) {
    return null;
  }
  const parts: string[] = [];
  if (leader.execution_result && leader.execution_result !== "SUCCESS") {
    parts.push(leader.execution_result);
  }
  if (leader.error_code) parts.push(String(leader.error_code));
  const payload = leader.result?.payload;
  if (payload !== undefined && payload !== null) {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    parts.push(text);
  }
  return parts.join(" · ") || "the contract rejected the call";
}

function receiptHash(receipt: ProtocolReceipt): string | null {
  const got = receipt?.transaction_hash ?? receipt?.hash;
  return got ? String(got) : null;
}

export function humanizeError(error: unknown): string {
  const message = messageOf(error);
  const code =
    (error as { code?: number })?.code ?? (error as { cause?: { code?: number } })?.cause?.code;
  if (/not configured|NEXT_PUBLIC_OBSERVA_ADDRESS/i.test(message)) {
    return "Observa has no contract address yet. Set NEXT_PUBLIC_OBSERVA_ADDRESS in frontend/.env.local.";
  }
  if (code === 4001 || /user rejected|rejected the request|denied/i.test(message)) {
    return "Rejected in the wallet.";
  }
  if (/chain/i.test(message) && /mismatch|not the expected|wrong/i.test(message)) {
    return "Wallet is on the wrong network. Switch to Genlayer Studio Network.";
  }
  if (/rate limit|-32029|retry_after/i.test(message)) {
    return "The Studio node is rate-limiting requests. Give it a few seconds, then try again.";
  }
  if (/insufficient funds|exceeds balance/i.test(message)) {
    return "Not enough GEN to cover this action.";
  }
  if (/timeout|timed out|gave up|deadline/i.test(message)) {
    return "This is taking longer than usual. It may still settle — refresh the record in a minute before retrying.";
  }
  return message || "The call failed.";
}

async function waitForReceipt(client: Client, hash: string): Promise<ProtocolReceipt> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status: "ACCEPTED",
        interval: CONSENSUS_WAIT.intervalMs,
        retries: CONSENSUS_WAIT.retries,
      });
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Submit a write, wait out consensus, and resolve to a settled receipt.
 * The receipt is only trusted once its own hash matches the submitted one.
 */
export async function submit(
  client: Client,
  functionName: string,
  args: unknown[] = [],
  value = 0n,
  onPhase?: PhaseReporter,
): Promise<WriteResult> {
  if (!isConfigured) {
    return {
      ok: false,
      message:
        "Observa has no contract address yet. Set NEXT_PUBLIC_OBSERVA_ADDRESS in frontend/.env.local.",
    };
  }
  onPhase?.("signing");
  let hash: string;
  try {
    hash = String(
      await client.writeContract({
        address: ADDRESS,
        functionName,
        args,
        value,
        consensusMaxRotations: 5,
      }),
    );
  } catch (error) {
    return { ok: false, message: humanizeError(error) };
  }

  onPhase?.("waiting");
  let receipt: ProtocolReceipt;
  try {
    receipt = await waitForReceipt(client, hash);
  } catch (error) {
    return { ok: false, message: humanizeError(error), hash };
  }

  const echoed = receiptHash(receipt);
  if (echoed && echoed.toLowerCase() !== hash.toLowerCase()) {
    return {
      ok: false,
      message:
        "The node returned a receipt for a different transaction. Refresh and check the record before retrying.",
      hash,
    };
  }

  const failure = leaderFailure(receipt);
  if (failure) {
    const clean = failure.replace(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\]\s*/g, "");
    return { ok: false, message: clean, hash };
  }

  onPhase?.("confirmed");
  return { ok: true, hash, receipt };
}

// ------------------------------------------------------------ contract writes

export const openDeal = (
  client: Client,
  provider: string,
  termsJson: string,
  onPhase?: PhaseReporter,
) => submit(client, "open_deal", [provider, termsJson], 0n, onPhase);

export const fundDeal = (client: Client, id: string, amount: bigint, onPhase?: PhaseReporter) =>
  submit(client, "fund_deal", [id], amount, onPhase);

export const startDeal = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "start_deal", [id], 0n, onPhase);

export const cancelDeal = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "cancel_deal", [id], 0n, onPhase);

export const probeSlot = (client: Client, id: string, slot: number, onPhase?: PhaseReporter) =>
  submit(client, "probe_slot", [id, slot], 0n, onPhase);

export const commitAttestation = (
  client: Client,
  id: string,
  digest: string,
  nonce: string,
  onPhase?: PhaseReporter,
) => submit(client, "commit_attestation", [id, digest, nonce], 0n, onPhase);

export const submitAttestation = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "submit_attestation", [id], 0n, onPhase);

export const settle = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "settle", [id], 0n, onPhase);

export const appeal = (client: Client, id: string, bond: bigint, onPhase?: PhaseReporter) =>
  submit(client, "appeal", [id], bond, onPhase);

export const resolveAppeal = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "resolve_appeal", [id], 0n, onPhase);

export const finalize = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "finalize", [id], 0n, onPhase);

export const claimLapsed = (client: Client, id: string, onPhase?: PhaseReporter) =>
  submit(client, "claim_lapsed", [id], 0n, onPhase);

export const pumpPayouts = (client: Client, onPhase?: PhaseReporter) =>
  submit(client, "pump_payouts", [], 0n, onPhase);

export const retryPayout = (
  client: Client,
  id: string,
  kind: PayoutRow["kind"],
  onPhase?: PhaseReporter,
) => submit(client, "retry_payout", [id, kind], 0n, onPhase);

export const recoverPayout = (
  client: Client,
  id: string,
  kind: PayoutRow["kind"],
  onPhase?: PhaseReporter,
) => submit(client, "recover_payout", [id, kind], 0n, onPhase);

export const confirmPayout = (
  client: Client,
  id: string,
  kind: PayoutRow["kind"],
  onPhase?: PhaseReporter,
) => submit(client, "confirm_payout", [id, kind], 0n, onPhase);

// ---------------------------------------------------------------- attestation

/**
 * The canonical bytes both the contract and a monitor hash. Mirrors Python's
 * `json.dumps(value, sort_keys=True, separators=(",", ":"))` for the ASCII
 * reports this app emits. Non-ASCII should be escaped by the publisher; that is
 * the monitor's responsibility, and a mismatch is rejected by the contract.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function canonicalDigest(report: unknown): Promise<string> {
  return sha256Hex(canonicalJson(report));
}
