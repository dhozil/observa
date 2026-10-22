/**
 * End-to-end demo of Observa on Studionet.
 *
 * The demo uses one real probe: `probe_slot` sends the committee to
 * https://example.com and validators independently agree on UP/DOWN. Settlement
 * itself is deterministic integer arithmetic, so it does not need a model.
 *
 * It creates an escrow, starts the window, probes slot 0, waits out a short SLA
 * window, settles, files a bonded appeal, waits for the evidence deadline,
 * re-derives, finalizes, and prints the payout ledger. A second deal demonstrates
 * the pre-start cancel/refund path.
 *
 * A fresh demo deploy shortens only APPEAL_WINDOW_SEC to 30s so the full lifecycle
 * fits in a demo; production keeps the one-hour window. When attaching to an
 * existing contract (`--address`), the demo never bypasses that contract's real
 * deadline: if it is longer than a minute, the run stops after proving that an
 * immediate resolve is rejected.
 *
 * Usage:
 *   node deploy/demoScript.ts                         # deploy fresh, then run
 *   node deploy/demoScript.ts --address 0x...         # run against an existing one
 *   OBSERVA_ADDRESS=0x... node deploy/demoScript.ts
 *
 * Client key: DEPLOYER_PRIVATE_KEY, the project wallet's GENLAYER_DEV_KEY, or
 *             scripts/.deployer.tmp.
 * Provider key: OBSERVA_SELLER_KEY, or the wallet's seller.json privateKey.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const WALLET_DIR = process.env.OBSERVA_WALLET_DIR ?? "D:\\Genlayer-project\\wallet";
const WALLET_ENV = process.env.OBSERVA_KEY_FILE ?? path.join(WALLET_DIR, ".env");
const SELLER_ENV = process.env.OBSERVA_SELLER_KEY_FILE ?? path.join(WALLET_DIR, "seller.env");
const SELLER_JSON = path.join(WALLET_DIR, "seller.json");

const ONE = 10n ** 18n;
const GEN = (n: number) => BigInt(n) * ONE;
const SLEEP = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TERMS = JSON.stringify({
  service: "Public status endpoint",
  endpoint: "https://example.com",
  window_seconds: 10,
  slots: 1,
  uptime_target_bps: 9900,
  min_coverage_bps: 5000,
});
const WINDOW = 10;
const DEMO_APPEAL_WINDOW = 30;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = "1";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const short = (hash: string) => String(hash).slice(0, 12) + ".";
const line = (n: number, text: string) => console.log(`\n[${n}] ${text}`);

const { makeDriver, createRawClient, readKeyFromEnv, readKeyFromJson } = createRequire(import.meta.url)(
  path.join(ROOT, "scripts", "studionet.cjs"),
);

function loadKeys() {
  const clientKey =
    process.env.DEPLOYER_PRIVATE_KEY ||
    readKeyFromEnv([WALLET_ENV, path.join(ROOT, "scripts", ".deployer.tmp")], [
      "GENLAYER_DEV_KEY",
      "DEPLOYER_PRIVATE_KEY",
    ]);
  const providerKey =
    process.env.OBSERVA_SELLER_KEY ||
    readKeyFromEnv([SELLER_ENV], ["OBSERVA_SELLER_KEY", "GENLAYER_DEV_KEY"]) ||
    readKeyFromJson(SELLER_JSON, "privateKey");
  if (!clientKey) throw new Error("no client key: set DEPLOYER_PRIVATE_KEY or GENLAYER_DEV_KEY");
  if (!providerKey) throw new Error(`no provider key: set OBSERVA_SELLER_KEY or put one in ${SELLER_JSON}`);
  return { clientKey, providerKey };
}

function must(res: { ok: boolean; phase?: string; reason?: string; hash?: string }, label: string) {
  if (!res.ok) throw new Error(`${label} failed at ${res.phase}: ${res.reason}`);
  console.log(`   ok  ${label}  ${short(res.hash ?? "")}`);
  return res;
}

async function openDeal(driver: any, contract: string, provider: string): Promise<string> {
  must(await driver.writeTo(contract, "open_deal", [provider, TERMS]), "open_deal");
  const count = Number(await driver.readFrom(contract, "get_deal_count"));
  return "s" + count;
}

async function main() {
  const { clientKey, providerKey } = loadKeys();
  const shared = { lastCall: 0 };
  const client = createRawClient(clientKey);
  const provider = createRawClient(providerKey);
  const cd = makeDriver(client, shared);
  const pd = makeDriver(provider, shared);

  console.log(`client    ${client.account.address}`);
  console.log(`provider  ${provider.account.address}`);

  line(1, "deploy or attach");
  let contract = args.address || process.env.OBSERVA_ADDRESS || "";
  if (contract) {
    console.log(`   using existing contract ${contract}`);
  } else {
    const source = fs
      .readFileSync(path.join(ROOT, "contracts", "observa.py"), "utf-8")
      .replace("APPEAL_WINDOW_SEC = 3600", `APPEAL_WINDOW_SEC = ${DEMO_APPEAL_WINDOW}`);
    const created = await cd.deployContract(source, []);
    if (!created.ok) throw new Error(`deploy failed at ${created.phase}: ${created.reason}`);
    contract = String(created.address);
    console.log(`   ok  deployed  ${short(created.hash ?? "")}`);
    console.log(`   contract ${contract}`);
    console.log(`   demo appeal window ${DEMO_APPEAL_WINDOW}s (production source stays 3600s)`);
  }

  line(2, "make sure the provider can stake an appeal bond");
  const providerBalance = BigInt(await pd.balance());
  console.log(`   provider holds ${Number(providerBalance) / 1e18} GEN`);
  if (providerBalance < GEN(2)) {
    const funded = await cd.transfer(provider.account.address, GEN(2));
    if (!funded.ok) throw new Error(`funding the provider failed at ${funded.phase}: ${funded.reason}`);
    console.log(`   ok  funded provider  ${short(funded.hash ?? "")}`);
  }

  // --- Deal A: probe, settle, bonded appeal, finalize ---------------------
  line(3, "deal A: open -> fund -> start -> probe -> settle -> appeal -> resolve_appeal -> finalize");
  const dealA = await openDeal(cd, contract, provider.account.address);
  const escrowA = GEN(5);
  must(await cd.writeTo(contract, "fund_deal", [dealA], escrowA), "A.fund_deal");
  must(await pd.writeTo(contract, "start_deal", [dealA]), "A.start_deal");
  must(await cd.writeTo(contract, "probe_slot", [dealA, 0]), "A.probe_slot");

  const logA = JSON.parse(String(await cd.readFrom(contract, "get_monitor_log", [dealA])));
  console.log(`   slot 0: ${JSON.stringify(logA[0])}`);

  console.log(`   waiting ${WINDOW + 6}s for the SLA window to close`);
  await SLEEP((WINDOW + 6) * 1000);
  must(await cd.writeTo(contract, "settle", [dealA]), "A.settle");
  const settled = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealA])));
  console.log(`   tentative: ${settled.status} / ${settled.outcome} / release ${settled.release_bps} bps`);

  const bond = (escrowA * 2500n) / 10000n;
  must(await pd.writeTo(contract, "appeal", [dealA], bond), `A.appeal (bond ${bond} atto)`);

  const demoConfig = JSON.parse(String(await cd.readFrom(contract, "get_config")));
  const appealWait = Number(demoConfig.appeal_window_sec);
  const earlyResolve = await cd.writeTo(contract, "resolve_appeal", [dealA]);
  if (earlyResolve.ok) {
    throw new Error("resolve_appeal succeeded before the evidence deadline; refusing to finalize");
  }
  console.log(`   early resolve rejected while ${appealWait}s window is open`);

  if (appealWait <= 60) {
    console.log(`   waiting ${appealWait + 5}s for the appeal deadline`);
    await SLEEP((appealWait + 5) * 1000);
    must(await cd.writeTo(contract, "resolve_appeal", [dealA]), "A.resolve_appeal");
    must(await cd.writeTo(contract, "finalize", [dealA]), "A.finalize");
  } else {
    console.log("   attached contract uses a long deadline; stopping before finalize");
    console.log("   deploy a fresh demo contract to see the full payout path");
  }

  // --- Deal B: pre-start cancel ------------------------------------------
  line(4, "deal B: open -> fund -> cancel (refund)");
  const dealB = await openDeal(cd, contract, provider.account.address);
  must(await cd.writeTo(contract, "fund_deal", [dealB], GEN(2)), "B.fund_deal");
  must(await cd.writeTo(contract, "cancel_deal", [dealB]), "B.cancel_deal");

  // --- Views and the payout ledger ---------------------------------------
  line(5, "views");
  const finalA = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealA])));
  const finalB = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealB])));
  const auditA = JSON.parse(String(await cd.readFrom(contract, "get_deal_audit", [dealA])));
  const termsA = String(await cd.readFrom(contract, "get_terms", [dealA]));
  const payoutsA = JSON.parse(String(await cd.readFrom(contract, "get_payouts", [dealA])));
  const pending = JSON.parse(String(await cd.readFrom(contract, "get_pending_payouts")));
  const stats = JSON.parse(String(await cd.readFrom(contract, "get_stats")));
  const config = JSON.parse(String(await cd.readFrom(contract, "get_config")));
  const ids = JSON.parse(String(await cd.readFrom(contract, "get_deal_ids")));
  const log = JSON.parse(String(await cd.readFrom(contract, "get_log", [0, 8])));

  console.log(`   deals          ${ids.join(", ")}`);
  console.log(`   A              ${finalA.status} / ${finalA.outcome} / release ${finalA.release_bps} bps`);
  console.log(`   A audit        appeal_decided=${auditA.appeal_decided} final=${auditA.final} evidence_unavailable=${auditA.appeal_evidence_unavailable}`);
  console.log(`   B              ${finalB.status}`);
  console.log(`   terms(A)       ${termsA.slice(0, 70)}…`);
  if (finalA.status === "FINALIZED") {
    console.log(`   provider row   ${JSON.stringify(payoutsA.payouts.find((row: any) => row.kind === "provider"))}`);
    console.log(`   bond row       ${JSON.stringify(payoutsA.payouts.find((row: any) => row.kind === "bond"))}`);
  } else {
    console.log("   payout rows    pending the attached contract's evidence deadline");
  }
  console.log(`   pending        ${pending.length} row(s)`);
  console.log(`   stats          ${JSON.stringify(stats)}`);
  console.log(`   max_slots      ${config.max_slots}`);
  console.log(`   log[0:8]       ${log.length} entries`);

  if (finalA.status === "FINALIZED") {
    console.log("\nPayout rows are deliberately asynchronous: after finalize they move");
    console.log("owed -> sent -> delivered, and `node deploy/verifyScript.ts` checks that");
    console.log("transition. The demo only reports what the ledger recorded.");
  }
  console.log(`\ncontract ${contract}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
