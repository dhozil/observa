/**
 * Verify Observa on Studionet, not just deploy it.
 *
 * The script runs two money paths against real consensus:
 *   - fund -> cancel: the whole escrow is refunded;
 *   - fund -> start -> probe -> settle -> bonded appeal -> resolve -> finalize:
 *     the escrow is released, the losing appeal bond goes to the counterparty,
 *     and the payout ledger is reconciled.
 *
 * Payout delivery is asynchronous, so each `sent` row is confirmed by polling
 * `confirm_payout` until the balance snapshot proves the value left. If the
 * child transfer is slower than the poll, the accounting invariant is still
 * checked with the row pending rather than pretending it was paid.
 *
 * Usage:
 *   node deploy/verifyScript.ts                 # deploy a fresh contract
 *   node deploy/verifyScript.ts --address 0x... # require an empty contract
 *
 * Keys: client from DEPLOYER_PRIVATE_KEY / the wallet; provider from
 *       OBSERVA_SELLER_KEY / the wallet's seller.json.
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
const KEY_TMP = path.join(ROOT, "scripts", ".deployer.tmp");

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

const {
  makeDriver,
  createRawClient,
  readKeyFromEnv,
  readKeyFromJson,
  sleep,
} = createRequire(import.meta.url)(path.join(ROOT, "scripts", "studionet.cjs"));

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
}
const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);

function loadKeys() {
  const clientKey =
    process.env.DEPLOYER_PRIVATE_KEY ||
    readKeyFromEnv([WALLET_ENV, KEY_TMP], ["GENLAYER_DEV_KEY", "DEPLOYER_PRIVATE_KEY"]);
  const providerKey =
    process.env.OBSERVA_SELLER_KEY ||
    readKeyFromEnv([SELLER_ENV], ["OBSERVA_SELLER_KEY", "GENLAYER_DEV_KEY"]) ||
    readKeyFromJson(SELLER_JSON, "privateKey");
  if (!clientKey) throw new Error("no client key");
  if (!providerKey) throw new Error("no provider key");
  return { clientKey, providerKey };
}

function must(res: { ok: boolean; phase?: string; reason?: string }, label: string) {
  if (!res.ok) throw new Error(`${label} failed at ${res.phase}: ${res.reason}`);
  return res;
}

async function openDeal(driver: any, contract: string, provider: string): Promise<string> {
  must(await driver.writeTo(contract, "open_deal", [provider, TERMS]), "open_deal");
  return "s" + Number(await driver.readFrom(contract, "get_deal_count"));
}

async function pendingRows(driver: any, contract: string, dealId: string) {
  return JSON.parse(String(await driver.readFrom(contract, "get_payouts", [dealId]))).payouts;
}

/** Poll confirm_payout until the row is delivered or the attempts run out. */
async function confirmWhenDelivered(driver: any, contract: string, dealId: string, kind: string, attempts = 4) {
  let row;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    row = (await pendingRows(driver, contract, dealId)).find((item: any) => item.kind === kind);
    if (!row) return null;
    if (row.state === "delivered") return row;
    if (row.state !== "sent") return row;
    const res = await driver.writeTo(contract, "confirm_payout", [dealId, kind]);
    if (res.ok) {
      console.log(`   confirmed ${dealId}:${kind} (attempt ${attempt})`);
      return (await pendingRows(driver, contract, dealId)).find((item: any) => item.kind === kind);
    }
    if (!/not observably delivered|has no attempt/i.test(String(res.reason))) {
      console.log(`   confirm ${dealId}:${kind} failed: ${res.reason}`);
      return row;
    }
    await sleep(6000);
  }
  return row;
}

async function main() {
  const { clientKey, providerKey } = loadKeys();
  const shared = { lastCall: 0 };
  const client = createRawClient(clientKey);
  const provider = createRawClient(providerKey);
  const cd = makeDriver(client, shared);
  const pd = makeDriver(provider, shared);
  const clientAddr = client.account.address;
  const providerAddr = provider.account.address;
  console.log(`client    ${clientAddr}`);
  console.log(`provider  ${providerAddr}`);

  const i = process.argv.indexOf("--address");
  const target = i >= 0 ? process.argv[i + 1] : process.env.OBSERVA_ADDRESS || "";

  step(1, target ? "attach to an empty contract" : "deploy a fresh contract");
  let contract = target;
  if (contract) {
    const existing = Number(await cd.readFrom(contract, "get_deal_count"));
    check("target is empty", existing === 0, `deal_count=${existing}`);
    if (existing !== 0) throw new Error("verification needs an empty contract");
  } else {
    const source = fs.readFileSync(path.join(ROOT, "contracts", "observa.py"), "utf-8");
    const created = await cd.deployContract(source, []);
    must(created, "deploy");
    contract = String(created.address);
    check("deploy read-back get_deal_count == 0", Number(await cd.readFrom(contract, "get_deal_count")) === 0);
    console.log(`   contract ${contract}`);
  }

  const providerBalance = BigInt(await pd.balance());
  console.log(`   provider balance ${Number(providerBalance) / 1e18} GEN`);
  if (providerBalance < GEN(2)) {
    must(await cd.transfer(providerAddr, GEN(2)), "fund provider");
  }

  // -------------------------------------------------------- cancel/refund
  step(2, "deal A: open -> fund -> cancel refunds the client");
  const dealA = await openDeal(cd, contract, providerAddr);
  const escrowA = GEN(2);
  must(await cd.writeTo(contract, "fund_deal", [dealA], escrowA), "A.fund_deal");
  must(await cd.writeTo(contract, "cancel_deal", [dealA]), "A.cancel_deal");
  let viewA = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealA])));
  check("A status REFUNDED", viewA.status === "REFUNDED", viewA.status);
  let rowsA = await pendingRows(cd, contract, dealA);
  check("A has one client refund", rowsA.length === 1 && rowsA[0].kind === "client", JSON.stringify(rowsA));
  check("A refund amount is the escrow", rowsA[0]?.amount_atto === String(escrowA), rowsA[0]?.amount_atto);
  const confirmedA = await confirmWhenDelivered(cd, contract, dealA, "client");
  check("A refund delivered", confirmedA?.state === "delivered", confirmedA?.state);

  // ------------------------------------------------ probe/settle/appeal
  step(3, "deal B: probe -> settle -> appeal -> resolve -> finalize");
  const dealB = await openDeal(cd, contract, providerAddr);
  const escrowB = GEN(5);
  must(await cd.writeTo(contract, "fund_deal", [dealB], escrowB), "B.fund_deal");
  must(await pd.writeTo(contract, "start_deal", [dealB]), "B.start_deal");
  must(await cd.writeTo(contract, "probe_slot", [dealB, 0]), "B.probe_slot");
  const monitorLog = JSON.parse(String(await cd.readFrom(contract, "get_monitor_log", [dealB])));
  check("B slot 0 observed UP", monitorLog[0]?.s === "UP", JSON.stringify(monitorLog[0]));

  console.log(`   waiting ${WINDOW + 6}s for the window`);
  await SLEEP((WINDOW + 6) * 1000);
  must(await cd.writeTo(contract, "settle", [dealB]), "B.settle");
  const settled = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealB])));
  check("B tentative verdict is MET", settled.status === "RESOLVED" && settled.outcome === "MET", `${settled.status}/${settled.outcome}`);

  const bond = (escrowB * 2500n) / 10000n;
  must(await pd.writeTo(contract, "appeal", [dealB], bond), "B.appeal");
  must(await cd.writeTo(contract, "resolve_appeal", [dealB]), "B.resolve_appeal");
  must(await cd.writeTo(contract, "finalize", [dealB]), "B.finalize");

  const viewB = JSON.parse(String(await cd.readFrom(contract, "get_deal", [dealB])));
  const auditB = JSON.parse(String(await cd.readFrom(contract, "get_deal_audit", [dealB])));
  check("B status FINALIZED", viewB.status === "FINALIZED", viewB.status);
  check("B outcome MET", viewB.outcome === "MET", viewB.outcome);
  check("B release_bps 10000", Number(viewB.release_bps) === 10000, String(viewB.release_bps));
  check("B appeal decided", auditB.appeal_decided === true && auditB.final === true);
  check("B no evidence fallback", auditB.appeal_evidence_unavailable === false);

  const providerRow = await confirmWhenDelivered(cd, contract, dealB, "provider");
  check("B provider payout delivered", providerRow?.state === "delivered", providerRow?.state);
  const bondRow = await confirmWhenDelivered(cd, contract, dealB, "bond");
  check("B losing appeal bond goes to the client", bondRow?.recipient.toLowerCase() === clientAddr.toLowerCase(), bondRow?.recipient);
  check("B bond delivered", bondRow?.state === "delivered", bondRow?.state);

  // ---------------------------------------------------------------- views
  step(4, "views and invariants");
  const ids = JSON.parse(String(await cd.readFrom(contract, "get_deal_ids")));
  const terms = String(await cd.readFrom(contract, "get_terms", [dealB]));
  const stats = JSON.parse(String(await cd.readFrom(contract, "get_stats")));
  const config = JSON.parse(String(await cd.readFrom(contract, "get_config")));
  const log = JSON.parse(String(await cd.readFrom(contract, "get_log", [0, 100])));
  const pending = JSON.parse(String(await cd.readFrom(contract, "get_pending_payouts")));
  const rowsB = await pendingRows(cd, contract, dealB);

  check("get_deal_ids == s1,s2", ids.join(",") === "s1,s2", ids.join(","));
  check("get_terms returns the committed terms", terms.includes("uptime_target_bps") && terms.includes("example.com"));
  check("get_log returns entries", log.length > 0, `${log.length}`);
  check("get_config max_slots", Number(config.max_slots) === 720, String(config.max_slots));
  check("B has provider + bond rows", rowsB.length === 2, JSON.stringify(rowsB.map((row: any) => row.kind)));
  check("B provider row amount is escrow", rowsB.find((row: any) => row.kind === "provider")?.amount_atto === String(escrowB));
  check("B bond row amount is bond", rowsB.find((row: any) => row.kind === "bond")?.amount_atto === String(bond));

  const delivered = rowsA.concat(rowsB).filter((row: any) => row.state === "delivered");
  const pendingSum = pending.reduce((sum: bigint, row: any) => sum + BigInt(row.amount_atto), 0n);
  check("held_atto equals pending obligations", BigInt(stats.held_atto) === pendingSum, `${stats.held_atto} vs ${pendingSum}`);
  check("conserved is true", stats.conserved === true, JSON.stringify(stats));
  check(
    "lifetime_inflow == lifetime_outflow when everything is delivered",
    pending.length > 0 || BigInt(stats.lifetime_inflow_atto) === BigInt(stats.lifetime_outflow_atto),
    `${stats.lifetime_inflow_atto}/${stats.lifetime_outflow_atto}`,
  );
  check("delivered rows cover the escrow release", delivered.some((row: any) => row.kind === "provider" && row.amount_atto === String(escrowB)));

  console.log(`\ncontract ${contract}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
