/**
 * Frontend <-> live contract integration test.
 *
 * Everything the frontend ships flows through frontend/src/lib/observa.ts and
 * frontend/src/lib/genlayer.ts. This drives those exact modules - not a
 * re-implementation - against the deployed Studionet contract, so a helper that
 * builds the wrong calldata or mis-parses a response fails here instead of in
 * the browser.
 *
 * Default (read-only, no keys, safe to run repeatedly):
 *   node tests/frontendIntegration.ts
 * Add the revert/phase path (needs the client key):
 *   node tests/frontendIntegration.ts --write
 * Add a full probe -> settle -> appeal -> finalize path through the wrappers
 * (needs both keys; moves 0.01 GEN of escrow):
 *   node tests/frontendIntegration.ts --full
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const LOCAL_ENV = path.join(ROOT, "frontend", ".env.local");
const WALLET_DIR = process.env.OBSERVA_WALLET_DIR ?? "D:\\Genlayer-project\\wallet";
const WALLET_ENV = process.env.OBSERVA_KEY_FILE ?? path.join(WALLET_DIR, ".env");
const SELLER_ENV = process.env.OBSERVA_SELLER_KEY_FILE ?? path.join(WALLET_DIR, "seller.env");
const SELLER_JSON = path.join(WALLET_DIR, "seller.json");
const KEY_TMP = path.join(ROOT, "scripts", ".deployer.tmp");

const FULL = process.argv.includes("--full");
const WRITE = FULL || process.argv.includes("--write");
const ESCROW = 10n ** 16n; // 0.01 GEN
const WINDOW = 10;
const TERMS = JSON.stringify({
  service: "Public status endpoint",
  endpoint: "https://example.com",
  window_seconds: WINDOW,
  slots: 1,
  uptime_target_bps: 9900,
  min_coverage_bps: 5000,
});

if (!process.env.NEXT_PUBLIC_OBSERVA_ADDRESS && fs.existsSync(LOCAL_ENV)) {
  const match = fs.readFileSync(LOCAL_ENV, "utf-8").match(/^\s*NEXT_PUBLIC_OBSERVA_ADDRESS\s*=\s*(.*?)\s*$/m);
  if (match) process.env.NEXT_PUBLIC_OBSERVA_ADDRESS = match[1].replace(/^["']|["']$/g, "");
}

const require = createRequire(import.meta.url);
const { createRawClient, makeDriver, readKeyFromEnv, readKeyFromJson } = require(
  path.join(ROOT, "scripts", "studionet.cjs"),
);

const S: any = await import(pathToFileURL(path.join(ROOT, "frontend", "src", "lib", "observa.ts")).href);
const { makeReadClient } = await import(
  pathToFileURL(path.join(ROOT, "frontend", "src", "lib", "genlayer.ts")).href
);

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
}
const section = (text: string) => console.log(`\n[${text}]`);
const short = (hash: string) => String(hash).slice(0, 12) + ".";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const address = (value: unknown) => /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));

function loadKeys() {
  const clientKey =
    process.env.DEPLOYER_PRIVATE_KEY ||
    readKeyFromEnv([WALLET_ENV, KEY_TMP], ["GENLAYER_DEV_KEY", "DEPLOYER_PRIVATE_KEY"]);
  const providerKey =
    process.env.OBSERVA_SELLER_KEY ||
    readKeyFromEnv([SELLER_ENV], ["OBSERVA_SELLER_KEY", "GENLAYER_DEV_KEY"]) ||
    readKeyFromJson(SELLER_JSON, "privateKey");
  return { clientKey, providerKey };
}

async function main() {
  const read = makeReadClient();

  console.log("Observa frontend <-> live contract");
  console.log(`  contract:  ${S.ADDRESS || "(unset)"}`);
  console.log(`  mode:      ${FULL ? "full (reads + writes + escrow)" : WRITE ? "write (reads + revert path)" : "read-only"}`);

  section("1. read the market through the frontend readers");
  if (!S.isConfigured) {
    check("observa is configured", false, "set NEXT_PUBLIC_OBSERVA_ADDRESS or frontend/.env.local");
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = 1;
    return;
  }

  const ids = await S.getDealIds(read);
  check("getDealIds returns an array", Array.isArray(ids), `${ids?.length ?? "?"} ids`);
  check("ids look like s1..sN", ids.every((id: string) => /^s\d+$/.test(id)), ids.slice(0, 4).join(", "));
  check("getDealCount matches the id list", Number(await S.getDealCount(read)) === ids.length);

  const sample = ids.slice(0, 4);
  const deals = [];
  for (const id of sample) {
    deals.push(await S.getDeal(read, id));
    await sleep(400);
  }
  for (const deal of deals) {
    check(
      `getDeal(${deal.id}) shape`,
      typeof deal.id === "string" &&
        Object.values(S.STATUS).includes(deal.status) &&
        address(deal.client) &&
        address(deal.provider) &&
        typeof deal.terms_digest === "string" &&
        typeof deal.escrow_atto === "string",
      `${deal.status} / ${deal.outcome || "-"}`,
    );
  }

  const first = sample[0];
  if (first) {
    const terms = await S.getTerms(read, first);
    check(`getTerms(${first}) carries the committed endpoint`, terms?.endpoint === "https://example.com", terms?.endpoint);
    await sleep(400);
    const audit = await S.getAudit(read, first);
    check(`getDealAudit(${first}) returns the same deal`, audit?.id === first);
    await sleep(400);
    const monitor = await S.getMonitorLog(read, first);
    const view = deals[0];
    check(
      `getMonitorLog(${first}) has one entry per slot`,
      Array.isArray(monitor) && monitor.length === view.slots,
      `${monitor?.length ?? "?"}/${view.slots}`,
    );
    await sleep(400);
    const payouts = await S.getPayouts(read, first);
    check(
      `getPayouts(${first}) returns rows + reconciliation context`,
      Array.isArray(payouts?.payouts) && typeof payouts?.contract_balance_atto === "string",
      `${payouts?.payouts?.length ?? "?"} rows`,
    );
  }

  section("2. stats, config and log decode");
  const stats = await S.getStats(read);
  check("getStats reports conservation", stats.conserved === true, `held=${stats.held_atto}`);
  check("stats.deals matches the id list", Number(stats.deals) === ids.length);
  const config = await S.getConfig(read);
  check(
    "getConfig mirrors the protocol constants",
    Number(config.max_slots) === S.PROTOCOL.maxSlots &&
      Number(config.payout_grace_sec) === S.PROTOCOL.payoutGraceSec,
    `${config.max_slots} slots / ${config.payout_grace_sec}s grace`,
  );
  const log = await S.getLog(read, 0, 50);
  check(
    "getLog returns decoded entries",
    Array.isArray(log) && log.every((entry: any) => typeof entry.event === "string"),
    `${log.length} entries`,
  );
  const pending = await S.getPendingPayouts(read);
  check(
    "getPendingPayouts returns zero or more rows",
    Array.isArray(pending) &&
      pending.every((row: any) => ["owed", "sent"].includes(row.state) && typeof row.amount_atto === "string"),
    `${pending?.length ?? "?"} pending`,
  );

  section("3. reporting math tracks the live view");
  for (const deal of deals.slice(0, 2)) {
    check(
      `coverage(${deal.id}) is within bounds`,
      S.coverageBps(deal) >= 0 && S.coverageBps(deal) <= 10000,
      `${S.coverageBps(deal)} bps`,
    );
    check(
      `evidence(${deal.id}) is one of four states`,
      ["probes", "attestation", "inconclusive", "none"].includes(S.evidenceSource(deal)),
      S.evidenceSource(deal),
    );
  }

  if (WRITE) {
    section("4. write path - a revert surfaces, and phases are narrated");
    const { clientKey } = loadKeys();
    if (!clientKey) {
      check("client key available for the write path", false, "set GENLAYER_DEV_KEY");
    } else {
      const signed = createRawClient(clientKey);
      const phases: string[] = [];
      const target = ids[0] ?? "s999";
      const bogus = await S.fundDeal(signed, target, 0n, (phase: string) => phases.push(phase));
      check("a revert resolves to ok:false", bogus.ok === false, bogus.ok ? "unexpectedly succeeded" : "");
      check(
        "the revert carries an on-chain reason",
        typeof bogus.message === "string" && bogus.message.length > 0,
        bogus.message?.slice(0, 80),
      );
      check("phases narrate signing then waiting", phases[0] === "signing" && phases.includes("waiting"), phases.join(" -> "));
      check("no false confirmation on failure", !phases.includes("confirmed"));
    }
  } else {
    section("4. write path - skipped (pass --write to exercise it)");
  }

  if (FULL) {
    section("5. full path - open -> fund -> start -> probe -> settle -> appeal -> finalize");
    const { clientKey, providerKey } = loadKeys();
    if (!clientKey || !providerKey) {
      check("client and provider keys available for --full", false);
    } else {
      const client = createRawClient(clientKey);
      const provider = createRawClient(providerKey);
      const shared = { lastCall: 0 };
      const cd = makeDriver(client, shared);
      const pd = makeDriver(provider, shared);
      const phases: string[] = [];

      const opened = await S.openDeal(client, provider.account.address, TERMS, (phase: string) => phases.push(phase));
      check("openDeal succeeds", opened.ok === true, opened.ok ? short(opened.hash) : opened.message);
      check("openDeal reports confirmation", phases.includes("confirmed"), phases.join(" -> "));

      if (opened.ok) {
        const fresh = await S.getDealIds(read);
        const id = fresh[fresh.length - 1];
        const created = await S.getDeal(read, id);
        check("the new deal reads back OPEN", created.id === id && created.status === "OPEN", `${id} / ${created.status}`);
        check("the terms digest survived", typeof created.terms_digest === "string" && created.terms_digest.length === 64);

        const funded = await S.fundDeal(client, id, ESCROW, (phase: string) => phases.push(phase));
        check("fundDeal succeeds", funded.ok === true, funded.ok ? short(funded.hash) : funded.message);
        const fundedDeal = await S.getDeal(read, id);
        check(
          "the deal reads back FUNDED with the escrow",
          fundedDeal.status === "FUNDED" && BigInt(fundedDeal.escrow_atto) === ESCROW,
          `${fundedDeal.status} / ${fundedDeal.escrow_atto}`,
        );

        const started = await S.startDeal(provider, id, (phase: string) => phases.push(phase));
        check("startDeal succeeds", started.ok === true, started.ok ? short(started.hash) : started.message);
        const probed = await S.probeSlot(client, id, 0, (phase: string) => phases.push(phase));
        check("probeSlot succeeds", probed.ok === true, probed.ok ? short(probed.hash) : probed.message);
        const monitor = await S.getMonitorLog(read, id);
        check("slot 0 observed UP", monitor[0]?.s === "UP", JSON.stringify(monitor[0]));

        console.log(`   waiting ${WINDOW + 6}s for the SLA window`);
        await sleep((WINDOW + 6) * 1000);
        const settled = await S.settle(client, id, (phase: string) => phases.push(phase));
        check("settle succeeds", settled.ok === true, settled.ok ? short(settled.hash) : settled.message);
        const resolved = await S.getDeal(read, id);
        check("the tentative verdict is MET", resolved.status === "RESOLVED" && resolved.outcome === "MET", `${resolved.status}/${resolved.outcome}`);

        const bond = S.appealBondFor(ESCROW);
        const providerBalance = BigInt(await pd.balance());
        if (providerBalance < bond) {
          const fundedProvider = await cd.transfer(provider.account.address, bond);
          check("the provider is funded for the bond", fundedProvider.ok === true, fundedProvider.reason ?? "");
        }
        const appealed = await S.appeal(provider, id, bond, (phase: string) => phases.push(phase));
        check("appeal succeeds", appealed.ok === true, appealed.ok ? short(appealed.hash) : appealed.message);
        const rederived = await S.resolveAppeal(client, id, (phase: string) => phases.push(phase));
        check("resolveAppeal succeeds", rederived.ok === true, rederived.ok ? short(rederived.hash) : rederived.message);
        const finalized = await S.finalize(client, id, (phase: string) => phases.push(phase));
        check("finalize succeeds", finalized.ok === true, finalized.ok ? short(finalized.hash) : finalized.message);

        const finalDeal = await S.getDeal(read, id);
        check("the deal reads back FINALIZED/MET", finalDeal.status === "FINALIZED" && finalDeal.outcome === "MET", `${finalDeal.status}/${finalDeal.outcome}`);
        check("the appeal is final and evidence was available", finalDeal.appeal_decided === true && finalDeal.appeal_evidence_unavailable === false);
        const info = await S.getPayouts(read, id);
        const rows = info.payouts;
        check("the payout ledger has provider + bond rows", rows.some((row: any) => row.kind === "provider") && rows.some((row: any) => row.kind === "bond"), rows.map((row: any) => row.kind).join(","));
        check("the provider row is the escrow", rows.find((row: any) => row.kind === "provider")?.amount_atto === String(ESCROW));
        check("the bond row is the bond", rows.find((row: any) => row.kind === "bond")?.amount_atto === String(bond));
        check("stats stay conserved after finalize", (await S.getStats(read)).conserved === true);
        console.log(`   ${Number(ESCROW) / 1e18} GEN escrow settled through the frontend (deal ${id})`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

await main();
