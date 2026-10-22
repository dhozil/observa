/**
 * Deploy Observa to Studionet, and report what a deploy script exists to report:
 * whether the leader actually returned.
 *
 * A deployment that reaches FINALIZED and rolled back looks real and leaves an
 * address behind, so the driver verifies the receipt hash and reads the leader
 * receipt before this script calls it deployed.
 *
 * Usage:
 *   node deploy/deployScript.ts              # deploy and read it back
 *   node deploy/deployScript.ts --dry-run    # print what it would do
 *
 * Observa takes no constructor arguments. Studionet is reached through Node:
 * Cloudflare rejects the Python SDK's User-Agent.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const WALLET_DIR = process.env.OBSERVA_WALLET_DIR ?? "D:\\Genlayer-project\\wallet";
const WALLET_ENV = process.env.OBSERVA_KEY_FILE ?? path.join(WALLET_DIR, ".env");
const KEY_TMP = path.join(ROOT, "scripts", ".deployer.tmp");

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] !== undefined;

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

function rawKey(): string {
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY.trim();

  for (const file of [WALLET_ENV, KEY_TMP]) {
    if (!file || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    const match = text.match(/^\s*(?:GENLAYER_DEV_KEY|DEPLOYER_PRIVATE_KEY)\s*=\s*(.+?)\s*$/m);
    if (match) return match[1].replace(/^["']|["']$/g, "").trim();
    const bare = text.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(bare)) return bare;
  }

  console.error(
    "No deployer key. Set DEPLOYER_PRIVATE_KEY, or point OBSERVA_KEY_FILE at an env file\n" +
      `that holds GENLAYER_DEV_KEY (looked at ${WALLET_ENV}).`,
  );
  process.exit(1);
}

function loadDriver(): { makeClient: Function; makeDriver: Function } {
  const required = createRequire(import.meta.url);
  return required(path.join(ROOT, "scripts", "studionet.cjs"));
}

async function main() {
  const { makeClient, makeDriver } = loadDriver();
  fs.writeFileSync(KEY_TMP, rawKey(), { encoding: "utf-8", mode: 0o600 });
  let client;
  try {
    client = makeClient(KEY_TMP);
  } finally {
    fs.rmSync(KEY_TMP, { force: true });
  }
  const { deployContract, readFrom, balance } = makeDriver(client);

  console.log(`deployer   ${client.account.address}`);
  console.log(`balance    ${(Number(await balance()) / 1e18).toFixed(6)} GEN`);

  const source = fs.readFileSync(path.join(ROOT, "contracts", "observa.py"), "utf-8");

  if (dryRun) {
    console.log("\n--dry-run, so nothing will be sent. This would:");
    console.log("  1. deploy contracts/observa.py (no constructor arguments)");
    console.log("  2. read back get_deal_count and get_stats to confirm the deployment is real");
    return;
  }

  console.log("\n[1] deploy Observa");
  const created = await deployContract(source, []);
  if (!created.ok) {
    console.error(`  FAILED at ${created.phase}: ${created.reason}`);
    process.exit(1);
  }
  console.log(`  ${created.hash}`);
  const address = created.address;
  if (!address) {
    console.error("  the receipt carried no contract address");
    process.exit(1);
  }
  console.log(`  contract ${address}`);

  console.log("\n[2] read it back, because a FINALIZED receipt is not proof");
  const count = Number(await readFrom(address, "get_deal_count"));
  if (count !== 0) {
    console.error(`  a fresh contract reports ${count} deals, not 0`);
    process.exit(1);
  }
  const stats = JSON.parse(String(await readFrom(address, "get_stats")));
  if (stats.conserved !== true || stats.held_atto !== "0") {
    console.error(`  unexpected opening state: ${JSON.stringify(stats)}`);
    process.exit(1);
  }
  const config = JSON.parse(String(await readFrom(address, "get_config")));
  if (Number(config.max_slots) !== 720) {
    console.error(`  unexpected protocol config: ${JSON.stringify(config)}`);
    process.exit(1);
  }
  console.log(`  deals       ${stats.deals}`);
  console.log(`  held_atto   ${stats.held_atto}`);
  console.log(`  conserved   ${stats.conserved}`);
  console.log(`  max_slots   ${config.max_slots}`);

  console.log("\ndeployed. Next:");
  console.log(`  OBSERVA_ADDRESS=${address}`);
  console.log("  node deploy/demoScript.ts --address " + address);
  console.log("  node deploy/verifyScript.ts --address " + address);
  console.log("");
  console.log("There is no factory: whoever deploys is whoever chose the code.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
