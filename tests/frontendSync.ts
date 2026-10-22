/**
 * Frontend <-> contract sync check - the "is the frontend safe?" guard.
 *
 * The frontend is a thin skin over contracts/observa.py. If a method is renamed,
 * an argument is added, or a protocol constant drifts, the UI would call into the
 * void and only fail at runtime, on-chain. This parses the contract source,
 * imports the frontend's contract surface, and refuses to pass unless every
 * method, argument count, constant, status, outcome and digest rule lines up.
 *
 * No network. No keys. Runs anywhere:
 *   node tests/frontendSync.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CONTRACT = path.join(ROOT, "contracts", "observa.py");
const OBSERVA = path.join(ROOT, "frontend", "src", "lib", "observa.ts");
const LOCAL_ENV = path.join(ROOT, "frontend", ".env.local");

// observa.ts reads this at import time, exactly as Next does.
if (!process.env.NEXT_PUBLIC_OBSERVA_ADDRESS && fs.existsSync(LOCAL_ENV)) {
  const match = fs.readFileSync(LOCAL_ENV, "utf-8").match(/^\s*NEXT_PUBLIC_OBSERVA_ADDRESS\s*=\s*(.*?)\s*$/m);
  if (match) process.env.NEXT_PUBLIC_OBSERVA_ADDRESS = match[1].replace(/^["']|["']$/g, "");
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
}
const section = (text: string) => console.log(`\n[${text}]`);

// ---------------------------------------------------------- contract parsing

function splitParams(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "(" || ch === "{") depth += 1;
    if (ch === "]" || ch === ")" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((item) => item.trim()).filter(Boolean);
}

function paramName(param: string): string {
  return param.split(":")[0].split("=")[0].trim();
}

function parseContract(source: string) {
  const lines = source.split(/\r?\n/);
  const methods = new Map<string, { kind: string; payable: boolean; params: string[] }>();
  for (let i = 0; i < lines.length; i += 1) {
    const deco = lines[i].trim();
    if (!deco.startsWith("@gl.public.")) continue;
    const kind = deco.includes(".view") ? "view" : "write";
    const payable = deco.includes("payable");
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("def ")) j += 1;
    const match = (lines[j] ?? "")
      .trim()
      .match(/^def\s+([a-zA-Z_]\w*)\s*\((.*?)\)\s*(?:->\s*[^:]+)?:/);
    if (!match) continue;
    const name = match[1];
    // The runtime's own hook is public to the VM but no caller can invoke it.
    if (name.startsWith("_")) continue;
    const params = splitParams(match[2]).slice(1).map(paramName); // drop self
    methods.set(name, { kind, payable, params });
  }

  const constants = new Map<string, bigint>();
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(\d+|\d+\s*\*\*\s*\d+)\s*$/);
    if (!match) continue;
    const expr = match[2];
    const pow = expr.match(/^(\d+)\s*\*\*\s*(\d+)$/);
    constants.set(match[1], pow ? BigInt(pow[1]) ** BigInt(pow[2]) : BigInt(expr));
  }

  const statuses = new Set<string>();
  const outcomes = new Set<string>();
  for (const line of lines) {
    const status = line.match(/^STATUS_[A-Z_]+\s*=\s*"([A-Z_]+)"\s*$/);
    if (status) statuses.add(status[1]);
    const outcome = line.match(/^OUTCOME_[A-Z_]+\s*=\s*"([A-Z_]+)"\s*$/);
    if (outcome) outcomes.add(outcome[1]);
  }

  return { methods, constants, statuses, outcomes };
}

// ------------------------------------------------------- the frontend surface

const WRITE_CALLS = [
  { method: "open_deal", fn: "openDeal", args: 2, value: false },
  { method: "fund_deal", fn: "fundDeal", args: 1, value: true },
  { method: "start_deal", fn: "startDeal", args: 1, value: false },
  { method: "cancel_deal", fn: "cancelDeal", args: 1, value: false },
  { method: "probe_slot", fn: "probeSlot", args: 2, value: false },
  { method: "commit_attestation", fn: "commitAttestation", args: 3, value: false },
  { method: "submit_attestation", fn: "submitAttestation", args: 1, value: false },
  { method: "settle", fn: "settle", args: 1, value: false },
  { method: "appeal", fn: "appeal", args: 1, value: true },
  { method: "resolve_appeal", fn: "resolveAppeal", args: 1, value: false },
  { method: "finalize", fn: "finalize", args: 1, value: false },
  { method: "claim_lapsed", fn: "claimLapsed", args: 1, value: false },
  { method: "pump_payouts", fn: "pumpPayouts", args: 0, value: false },
  { method: "retry_payout", fn: "retryPayout", args: 2, value: false },
  { method: "recover_payout", fn: "recoverPayout", args: 2, value: false },
  { method: "confirm_payout", fn: "confirmPayout", args: 2, value: false },
];

const VIEW_CALLS = [
  { method: "get_deal", fn: "getDeal", args: 1 },
  { method: "get_terms", fn: "getTerms", args: 1 },
  { method: "get_monitor_log", fn: "getMonitorLog", args: 1 },
  { method: "get_deal_audit", fn: "getAudit", args: 1 },
  { method: "get_deal_ids", fn: "getDealIds", args: 0 },
  { method: "get_deal_count", fn: "getDealCount", args: 0 },
  { method: "get_config", fn: "getConfig", args: 0 },
  { method: "get_stats", fn: "getStats", args: 0 },
  { method: "get_log", fn: "getLog", args: 2 },
  { method: "get_payouts", fn: "getPayouts", args: 1 },
  { method: "get_pending_payouts", fn: "getPendingPayouts", args: 0 },
];

/** Public methods the frontend deliberately never calls, with the reason. */
const UNUSED = new Map<string, string>();

/** Contract constant -> frontend PROTOCOL key. */
const CONSTANT_MAP: Record<string, string> = {
  MAX_SLOTS: "maxSlots",
  PROBE_GRACE_SEC: "probeGraceSec",
  LAPSE_GRACE_SEC: "lapseGraceSec",
  DEFAULT_MIN_COVERAGE_BPS: "defaultMinCoverageBps",
  MIN_ESCROW_ATTO: "minEscrowAtto",
  APPEAL_WINDOW_SEC: "appealWindowSec",
  APPEAL_BOND_BPS: "appealBondBps",
  MIN_APPEAL_BOND_ATTO: "minAppealBondAtto",
  PAYOUT_GRACE_SEC: "payoutGraceSec",
  MAX_LOG: "maxLog",
};

async function main() {
  const contract = parseContract(fs.readFileSync(CONTRACT, "utf-8"));
  const src = fs.readFileSync(OBSERVA, "utf-8");
  const frontend: any = await import(pathToFileURL(OBSERVA).href);

  console.log("Observa frontend <-> contract sync");
  console.log(`  contract:  ${path.relative(ROOT, CONTRACT)}`);
  console.log(`  frontend:  ${path.relative(ROOT, OBSERVA)}`);

  // 1. Every frontend write must exist with the same arity.
  section("1. write methods the frontend calls");
  for (const call of WRITE_CALLS) {
    const on = contract.methods.get(call.method);
    check(
      `${call.method} <-> ${call.fn}()`,
      !!on &&
        on.kind === "write" &&
        on.params.length === call.args &&
        typeof frontend[call.fn] === "function" &&
        src.includes(`"${call.method}"`),
      on ? `${on.params.length} contract args` : "missing from contract",
    );
  }

  // 2. Every frontend read must exist with the same arity.
  section("2. view methods the frontend reads");
  for (const call of VIEW_CALLS) {
    const on = contract.methods.get(call.method);
    check(
      `${call.method} <-> ${call.fn}()`,
      !!on &&
        on.kind === "view" &&
        on.params.length === call.args &&
        typeof frontend[call.fn] === "function" &&
        src.includes(`"${call.method}"`),
      on ? `${on.params.length} contract args` : "missing from contract",
    );
  }

  // 3. No public method may be silently dropped by the frontend.
  section("3. no public method is silently dropped");
  for (const [name, on] of contract.methods) {
    const used = WRITE_CALLS.some((call) => call.method === name) || VIEW_CALLS.some((call) => call.method === name);
    if (used) continue;
    check(`${name} accounted for`, UNUSED.has(name), on.kind);
  }

  // 4. Only the methods the UI funds may be payable.
  section("4. payable surface");
  for (const [name, on] of contract.methods) {
    if (!on.payable) continue;
    const call = WRITE_CALLS.find((item) => item.method === name);
    check(`${name} is payable and funded by the UI`, !!call && call.value === true);
  }

  // 5. Protocol constants must not drift.
  section("5. protocol constants");
  for (const [constant, key] of Object.entries(CONSTANT_MAP)) {
    const expected = contract.constants.get(constant);
    const actual = frontend.PROTOCOL[key];
    check(
      `${constant} == PROTOCOL.${key}`,
      expected !== undefined && actual !== undefined && BigInt(actual) === expected,
      expected !== undefined ? `${expected}` : "missing",
    );
  }

  // 6. Statuses and outcomes.
  section("6. statuses & outcomes");
  const feStatuses = new Set(Object.values(frontend.STATUS));
  check(
    "frontend STATUS set matches the contract",
    contract.statuses.size === feStatuses.size && [...contract.statuses].every((status) => feStatuses.has(status)),
    `${contract.statuses.size} statuses`,
  );
  const feOutcomes = new Set(Object.keys(frontend.OUTCOME_LABEL));
  check(
    "frontend OUTCOME_LABEL set matches the contract",
    contract.outcomes.size === feOutcomes.size && [...contract.outcomes].every((outcome) => feOutcomes.has(outcome)),
    `${contract.outcomes.size} outcomes`,
  );

  // 7. Address and consensus-wait guards.
  section("7. runtime guards");
  const addressShape = /^0x[0-9a-fA-F]{40}$/;
  check(
    "ADDRESS is unset or a well-formed 0x address",
    frontend.ADDRESS === "" || addressShape.test(frontend.ADDRESS),
    frontend.ADDRESS || "(unset)",
  );
  check(
    "isConfigured matches ADDRESS",
    frontend.isConfigured === (addressShape.test(frontend.ADDRESS) && frontend.ADDRESS !== frontend.ZERO_ADDRESS),
  );
  const waitMs = frontend.CONSENSUS_WAIT.intervalMs * frontend.CONSENSUS_WAIT.retries;
  check("consensus wait is longer than 2 minutes", waitMs >= 120000, `~${Math.round(waitMs / 60000)} min`);

  // 8. Reporting math must agree on coverage authority.
  section("8. observation math");
  const baseDeal = {
    slots: 4,
    probed_slots: 1,
    up_slots: 1,
    min_coverage_bps: 5000,
    attested: false,
    attested_bps: 0,
    status: "ACTIVE",
    final: false,
    started_at_unix: 1000,
    slot_seconds: 10,
    end_unix: 2000,
    appeal_deadline_unix: 0,
  };
  check("1/4 coverage is 2500 bps", frontend.coverageBps(baseDeal) === 2500, String(frontend.coverageBps(baseDeal)));
  check("thin coverage is not authoritative", frontend.probeCoverageAuthoritative(baseDeal) === false);
  check("thin coverage reads as inconclusive", frontend.evidenceSource(baseDeal) === "inconclusive");
  check(
    "2/4 coverage clears a 5000 floor",
    frontend.probeCoverageAuthoritative({ ...baseDeal, probed_slots: 2, up_slots: 2 }) === true,
  );
  check(
    "attestation wins when probes are thin",
    frontend.evidenceSource({ ...baseDeal, attested: true, attested_bps: 9900 }) === "attestation",
  );
  check("no probes and no attestation is none", frontend.evidenceSource({ ...baseDeal, probed_slots: 0, up_slots: 0 }) === "none");
  check(
    "lapse requires the grace period",
    frontend.isLapsed({ ...baseDeal, probed_slots: 0, up_slots: 0 }, 2000 + frontend.PROTOCOL.lapseGraceSec + 1) === true,
  );
  check(
    "a bond is 25% of escrow",
    frontend.appealBondFor(4n * 10n ** 18n) === 10n ** 18n,
    String(frontend.appealBondFor(4n * 10n ** 18n)),
  );
  check(
    "nextProbeSlot finds the oldest open slot",
    frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1010) === 0,
    String(frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1010)),
  );
  check(
    "nextProbeSlot still finds grace slots after the window",
    frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1050) === 0,
    String(frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1050)),
  );
  check(
    "nextProbeSlot skips already probed grace slots",
    frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [{ s: "UP", http: 200 }, null, null, null], 1050) === 1,
    String(frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [{ s: "UP", http: 200 }, null, null, null], 1050)),
  );
  check(
    "nextProbeSlot returns null after every grace window",
    frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1400) === null,
    String(frontend.nextProbeSlot({ ...baseDeal, status: "ACTIVE" }, [null, null, null, null], 1400)),
  );

  // 9. The browser digest must match Python's canonical JSON.
  section("9. canonical report digest");
  const report = { nonce: "att-1", service: "ACME", uptime_bps: 9900 };
  const canonical = frontend.canonicalJson(report);
  check(
    "canonicalJson sorts keys and uses compact separators",
    canonical === '{"nonce":"att-1","service":"ACME","uptime_bps":9900}',
    canonical,
  );
  const digest = await frontend.canonicalDigest(report);
  check(
    "SHA-256 matches Python json.dumps(sort_keys=True, separators=(',',':'))",
    digest === "8c36033da4028ab82278ae0022444e0b3c9f7a55271b0c0728b2844b8e159bca",
    digest,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
