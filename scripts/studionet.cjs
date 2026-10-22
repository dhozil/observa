#!/usr/bin/env node
/**
 * Shared plumbing for the Observa Studionet drivers.
 *
 * The details that matter when talking to Studionet live here, once:
 *
 *  1. Only browser-like User-Agents get through Cloudflare. The Node.js SDK
 *     qualifies; the Python SDK does not, so the deploy scripts use Node.
 *  2. A transaction can reach ACCEPTED/FINALIZED and still have rolled back.
 *     Only consensus_data.leader_receipt says which happened, and
 *     result.payload is where the reason appears.
 *  3. A receipt is only believed once its hash matches the transaction that was
 *     just submitted, so an earlier transaction cannot be mistaken for this one.
 *  4. Studionet answers throttled requests with -32029 and a retry hint. Calls
 *     are paced and back off on that hint.
 *  5. genlayer-js is resolved from the global `genlayer` CLI install, so the
 *     deploy scripts do not need a local node_modules.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL_MODULES = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL_MODULES, "genlayer-js"));

const RPC_SPACING_MS = 2600;
const READ_ATTEMPTS = 24;
const READ_BACKOFF_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (atto) => `${(Number(BigInt(atto)) / 1e18).toFixed(6)} GEN`;

/**
 * Read a private key from the first env-like file that matches, or a bare
 * 32-byte hex key from a plain file. Returns null when nothing is found.
 */
function readKeyFromEnv(files, names = ["GENLAYER_DEV_KEY", "DEPLOYER_PRIVATE_KEY"]) {
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    for (const name of names) {
      const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"));
      if (match) return match[1].replace(/^["']|["']$/g, "").trim();
    }
    const bare = text.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(bare)) return bare;
  }
  return null;
}

/** Read a specific JSON field (e.g. a wallet export's privateKey). */
function readKeyFromJson(file, field) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const value = parsed[field];
    return typeof value === "string" && value.startsWith("0x") ? value : null;
  } catch {
    return null;
  }
}

function createRawClient(key) {
  return createClient({ chain: chains.studionet, account: createAccount(key.trim()) });
}

function makeClient(keyPath) {
  return createRawClient(fs.readFileSync(keyPath, "utf-8"));
}

function makeDriver(client, shared = { lastCall: 0 }) {
  async function paced(fn) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wait = shared.lastCall + RPC_SPACING_MS - Date.now();
      if (wait > 0) await sleep(wait);
      shared.lastCall = Date.now();
      try {
        return await fn();
      } catch (err) {
        // Cloudflare can answer with HTML instead of JSON; a stated rate limit,
        // a transport failure, or a 5xx is worth retrying. A contract revert is
        // not thrown here at all.
        const retryAfter = err?.data?.retry_after_seconds ?? err?.cause?.data?.retry_after_seconds;
        const message = `${err?.message ?? ""} ${err?.cause?.message ?? ""} ${err?.details ?? ""}`;
        const transient =
          /rate limit|unknown RPC error|unexpected token|DOCTYPE|bad gateway|service unavailable|gateway timeout|fetch failed|network error|ECONNRESET|socket hang up|\b50[234]\b|temporarily/i.test(
            message,
          );
        if (retryAfter === undefined && !transient) throw err;
        const backoff = retryAfter !== undefined ? (Number(retryAfter) + 2) * 1000 : 4000 * (attempt + 1);
        await sleep(backoff);
      }
    }
    throw new Error("gave up after repeated transient RPC failures");
  }

  /**
   * Reject a receipt that belongs to a different transaction.
   *
   * Receipts carry hashes under several names depending on the node version. A
   * receipt for an earlier transaction looks exactly like a successful one, so
   * compare before believing it.
   */
  function receiptHashMismatch(receipt, expected) {
    if (!expected) return null;
    const got =
      receipt?.transaction_hash ??
      receipt?.transactionHash ??
      receipt?.hash ??
      receipt?.to_transaction_hash;
    if (got === undefined || got === null) return null; // node did not echo it
    return String(got).toLowerCase() === String(expected).toLowerCase() ? null : `${got} != ${expected}`;
  }

  /** null when the leader actually returned, otherwise a diagnostic string. */
  function executionFailure(receipt) {
    const leader = receipt?.consensus_data?.leader_receipt?.[0];
    if (!leader) return "no leader receipt in the response";
    const status = leader.result?.status;
    if (leader.execution_result === "SUCCESS" && (status === undefined || status === "return")) return null;
    const parts = [];
    if (leader.execution_result !== "SUCCESS") parts.push(`execution_result=${leader.execution_result}`);
    if (leader.error_code) parts.push(`error_code=${leader.error_code}`);
    if (status) parts.push(`result=${status}`);
    const payload = leader.result?.payload;
    if (payload !== undefined && payload !== null) {
      parts.push(`payload=${(typeof payload === "string" ? payload : JSON.stringify(payload)).slice(0, 300)}`);
    }
    return parts.length ? parts.join(" | ") : "unknown failure";
  }

  async function readFrom(address, method, args = []) {
    let lastError;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      try {
        return await paced(() => client.readContract({ address, functionName: method, args }));
      } catch (err) {
        lastError = err;
        if (!/execution failed|invalid parameters|not found/i.test(err?.message ?? "")) throw err;
        await sleep(READ_BACKOFF_MS);
      }
    }
    throw lastError;
  }

  const waitReceipt = (hash) =>
    paced(() => client.waitForTransactionReceipt({ hash, status: "ACCEPTED", interval: 4000, retries: 120 }));

  async function writeTo(address, method, args = [], value = 0n) {
    let hash;
    try {
      hash = await paced(() =>
        client.writeContract({ address, functionName: method, args, value, consensusMaxRotations: 5 }),
      );
    } catch (err) {
      return { ok: false, phase: "submit", reason: err.message };
    }
    let receipt;
    try {
      receipt = await waitReceipt(hash);
    } catch (err) {
      return { ok: false, phase: "receipt", reason: err.message, hash };
    }
    const stale = receiptHashMismatch(receipt, hash);
    if (stale) return { ok: false, phase: "receipt", reason: `receipt is for another transaction: ${stale}`, hash };
    const failure = executionFailure(receipt);
    if (failure) return { ok: false, phase: "execute", reason: failure, hash, receipt };
    return { ok: true, hash, receipt };
  }

  async function deployContract(code, args = []) {
    let hash;
    try {
      hash = await paced(() => client.deployContract({ code, args, consensusMaxRotations: 5 }));
    } catch (err) {
      return { ok: false, phase: "submit", reason: err.message };
    }
    const receipt = await waitReceipt(hash);
    const stale = receiptHashMismatch(receipt, hash);
    if (stale) return { ok: false, phase: "receipt", reason: `receipt is for another transaction: ${stale}`, hash };
    const failure = executionFailure(receipt);
    if (failure) return { ok: false, phase: "execute", reason: failure, hash };
    return { ok: true, hash, address: receipt.contract_address || receipt.to_address };
  }

  const balance = () => paced(() => client.getBalance({ address: client.account.address }));

  /**
   * Send native GEN. A plain transfer has no contract execution, so success is
   * a matching receipt, not a leader return.
   */
  async function transfer(to, amount) {
    let hash;
    try {
      hash = await paced(() => client.sendTransaction({ to, value: amount }));
    } catch (err) {
      return { ok: false, phase: "submit", reason: err.message };
    }
    let receipt;
    try {
      receipt = await waitReceipt(hash);
    } catch (err) {
      return { ok: false, phase: "receipt", reason: err.message, hash };
    }
    const stale = receiptHashMismatch(receipt, hash);
    if (stale) return { ok: false, phase: "receipt", reason: `receipt is for another transaction: ${stale}`, hash };
    return { ok: true, hash, receipt };
  }

  return {
    paced,
    readFrom,
    writeTo,
    deployContract,
    transfer,
    waitReceipt,
    executionFailure,
    receiptHashMismatch,
    balance,
  };
}

module.exports = {
  makeClient,
  makeDriver,
  createRawClient,
  readKeyFromEnv,
  readKeyFromJson,
  sleep,
  fmt,
};
