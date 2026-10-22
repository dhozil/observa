/**
 * Browser end-to-end test for the Observa frontend.
 *
 * Unlike frontendIntegration.ts (which drives the typed wrappers in Node), this
 * loads the real production build in Chrome, connects two EIP-6963 wallets, and
 * clicks through a complete deal: open -> fund -> start -> probe -> settle ->
 * appeal -> resolve -> finalize.
 *
 * The wallets are real EIP-1193 providers with no extension: they announce over
 * EIP-6963, answer account/chain requests, and sign with the same keys the
 * deploy scripts use. That exercises the app's wallet discovery and tx UI
 * without ever touching `window.ethereum`.
 *
 * Run `npm --prefix frontend run build` first, then:
 *   node tests/frontendE2E.ts
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FRONTEND = path.join(ROOT, "frontend");
const LOCAL_ENV = path.join(FRONTEND, ".env.local");
const BUILD_ID = path.join(FRONTEND, ".next", "BUILD_ID");
const WALLET_DIR = process.env.OBSERVA_WALLET_DIR ?? "D:\\Genlayer-project\\wallet";
const WALLET_ENV = process.env.OBSERVA_KEY_FILE ?? path.join(WALLET_DIR, ".env");
const SELLER_ENV = process.env.OBSERVA_SELLER_KEY_FILE ?? path.join(WALLET_DIR, "seller.env");
const SELLER_JSON = path.join(WALLET_DIR, "seller.json");
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.OBSERVA_E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const RPC = "https://studio.genlayer.com/api";
const GEN = 10n ** 18n;
const ESCROW = GEN / 100n; // 0.01 GEN, the UI's default scale

if (!process.env.NEXT_PUBLIC_OBSERVA_ADDRESS && fs.existsSync(LOCAL_ENV)) {
  const match = fs.readFileSync(LOCAL_ENV, "utf-8").match(/^\s*NEXT_PUBLIC_OBSERVA_ADDRESS\s*=\s*(.*?)\s*$/m);
  if (match) process.env.NEXT_PUBLIC_OBSERVA_ADDRESS = match[1].replace(/^["']|["']$/g, "");
}
const ADDRESS = process.env.NEXT_PUBLIC_OBSERVA_ADDRESS ?? "";
if (!ADDRESS) throw new Error("NEXT_PUBLIC_OBSERVA_ADDRESS is unset (frontend/.env.local)");
if (!fs.existsSync(BUILD_ID)) throw new Error("frontend/.next is missing; run `npm --prefix frontend run build` first");
if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME_PATH)`);

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { readKeyFromEnv, readKeyFromJson, sleep } = require(path.join(ROOT, "scripts", "studionet.cjs"));
const viem = require(path.join(FRONTEND, "node_modules", "viem"));
const accounts = require(path.join(FRONTEND, "node_modules", "viem", "accounts"));

const CLIENT_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ||
  readKeyFromEnv([WALLET_ENV], ["GENLAYER_DEV_KEY", "DEPLOYER_PRIVATE_KEY"]);
const PROVIDER_KEY =
  process.env.OBSERVA_SELLER_KEY ||
  readKeyFromEnv([SELLER_ENV], ["OBSERVA_SELLER_KEY", "GENLAYER_DEV_KEY"]) ||
  readKeyFromJson(SELLER_JSON, "privateKey");
if (!CLIENT_KEY || !PROVIDER_KEY) {
  throw new Error("Both the client and provider keys are required for the E2E path");
}

const chromeFetch = (input: string | URL | Request, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  });

const studio = viem.defineChain({
  id: 61999,
  name: "Genlayer Studio Network",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const clientAccount = accounts.privateKeyToAccount(CLIENT_KEY.trim());
const providerAccount = accounts.privateKeyToAccount(PROVIDER_KEY.trim());
const wallets = [
  { uuid: "observa-client", name: "Observa Client", rdns: "test.observa.client", address: clientAccount.address, account: clientAccount },
  { uuid: "observa-provider", name: "Observa Provider", rdns: "test.observa.provider", address: providerAccount.address, account: providerAccount },
];

const walletClients = new Map(
  wallets.map((wallet) => [
    wallet.rdns,
    viem.createWalletClient({
      account: wallet.account,
      chain: studio,
      transport: viem.http(RPC, { fetchFn: chromeFetch, retryCount: 0 }),
    }),
  ]),
);

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
}
const section = (text: string) => console.log(`\n[${text}]`);
const short = (value: string) => `${String(value).slice(0, 10)}.`;

async function must(locator: any, label: string, timeout = 240_000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    check(label, true);
  } catch {
    check(label, false, "not visible before the timeout");
    throw new Error(`expected to see: ${label}`);
  }
}

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b/i;

async function pageText(page: any) {
  return page.locator("body").innerText().catch(() => "");
}

async function waitForOutcome(page: any, next: any, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await next.isVisible().catch(() => false)) return "done";
    const body = await pageText(page);
    if (RATE_LIMIT.test(body)) return "rate";
    await sleep(1_000);
  }
  return "timeout";
}

async function waitForNext(next: any, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await next.isVisible().catch(() => false)) return true;
    await sleep(2_000);
  }
  return false;
}

/**
 * Click a write button and wait for its result. Studionet rejects bursts with a
 * rate-limit notice; the app surfaces that as copy, so back off and retry the
 * same action instead of failing the run. A write can also succeed while the
 * button disappears before the refreshed view arrives, so re-check both sides.
 */
async function writeStep(page: any, action: any, next: any, label: string, timeout = 480_000) {
  const backoff = [15_000, 30_000, 60_000, 120_000, 180_000];
  let rateWaits = 0;

  const succeed = async (attempt: number) => {
    check(label, true, attempt > 1 ? `attempt ${attempt}` : "");
    await sleep(4_000);
  };

  const backOff = async () => {
    const wait = backoff[Math.min(rateWaits, backoff.length - 1)];
    rateWaits += 1;
    console.log(`   rate limited; waiting ${wait / 1000}s before retrying ${label}`);
    await sleep(wait);
  };

  for (let attempt = 1; attempt <= 7; attempt += 1) {
    if (await next.isVisible().catch(() => false)) {
      await succeed(attempt);
      return;
    }

    if (!(await action.isVisible().catch(() => false))) {
      const outcome = await waitForOutcome(page, next, 30_000);
      if (outcome === "done") {
        await succeed(attempt);
        return;
      }
      if (outcome === "rate") {
        await backOff();
        continue;
      }
      check(label, false, `action disappeared before ${label}`);
      throw new Error(`write step lost its action: ${label}`);
    }

    try {
      await action.click({ timeout: 15_000 });
    } catch {
      const outcome = await waitForOutcome(page, next, 15_000);
      if (outcome === "done") {
        await succeed(attempt);
        return;
      }
      if (outcome === "rate") {
        await backOff();
        continue;
      }
      check(label, false, `could not click ${label}`);
      throw new Error(`write step could not click: ${label}`);
    }

    const outcome = await waitForOutcome(page, next, timeout);
    if (outcome === "done") {
      await succeed(attempt);
      return;
    }
    if (outcome === "rate") {
      console.log(`   rate limited during ${label}; waiting for the refreshed view`);
      if (await waitForNext(next, 120_000)) {
        await succeed(attempt);
        return;
      }
      await backOff();
      continue;
    }

    const body = await pageText(page);
    check(label, false, body.slice(-180).replace(/\s+/g, " "));
    throw new Error(`write step timed out: ${label}`);
  }

  check(label, false, "still rate-limited after 7 attempts");
  throw new Error(`write step kept getting rate-limited: ${label}`);
}

function rateLimitDelay(error: any): number | null {
  const text = [error?.message, error?.details, error?.shortMessage, JSON.stringify(error?.cause ?? {})].join(" ");
  if (!RATE_LIMIT.test(text)) return null;
  const seconds = Number(error?.cause?.data?.retry_after_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds + 2, 300) * 1_000 : 20_000;
}

async function signAndSend(rdns: string, tx: Record<string, string>) {
  const wallet = wallets.find((entry) => entry.rdns === rdns);
  const client = walletClients.get(rdns);
  if (!wallet || !client) throw new Error(`unknown wallet ${rdns}`);
  if (String(tx.from ?? "").toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`wallet ${rdns} cannot sign for ${tx.from}`);
  }
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const hash = await client.sendTransaction({
        account: wallet.account,
        chain: studio,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
        nonce: tx.nonce ? Number(BigInt(tx.nonce)) : undefined,
        gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
        type: "legacy",
      });
      console.log(`   signed ${rdns}: ${short(hash)}`);
      return hash;
    } catch (error) {
      const wait = rateLimitDelay(error);
      if (wait === null) throw error;
      console.log(`   RPC rate limited while sending; waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  throw new Error(`wallet ${rdns} kept getting rate-limited while sending`);
}

function initWallets() {
  const payload = wallets.map(({ uuid, name, rdns, address }) => ({ uuid, name, rdns, address }));
  const script = `
    (() => {
      const wallets = ${JSON.stringify(payload)};
      const icon = "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#111"/><circle cx="16" cy="16" r="7" fill="#9fe0b0"/></svg>'
      );
      const handlers = new Map();
      const emit = (event, value) => {
        for (const handler of handlers.get(event) ?? []) handler(value);
      };
      const providerFor = (wallet) => ({
        async request({ method, params }) {
          if (method === "eth_chainId") return "0xf22f";
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet.address];
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
            emit("chainChanged", "0xf22f");
            return null;
          }
          if (method === "eth_sendTransaction") {
            return await window.__observaSendTx(wallet.rdns, params[0]);
          }
          throw Object.assign(new Error("unsupported method " + method), { code: 4200 });
        },
        on(event, handler) {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event).push(handler);
        },
        removeListener(event, handler) {
          handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler));
        },
      });
      const announce = () => {
        for (const wallet of wallets) {
          window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: { uuid: wallet.uuid, name: wallet.name, icon, rdns: wallet.rdns },
              provider: providerFor(wallet),
            },
          }));
        }
      };
      window.addEventListener("eip6963:requestProvider", announce);
      setTimeout(announce, 0);
    })();
  `;
  return script;
}

async function startServer() {
  const nextBin = path.join(FRONTEND, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: FRONTEND,
    env: { ...process.env, NEXT_PUBLIC_OBSERVA_ADDRESS: ADDRESS, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk) => (log += chunk.toString()));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${log}`);
    try {
      const response = await fetch(`${BASE}/`, { headers: { "User-Agent": "ObservaE2E" } });
      if (response.ok) return child;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error(`next start did not answer on ${BASE}:\n${log}`);
}

async function main() {
  console.log("Observa browser E2E");
  console.log(`  contract: ${ADDRESS}`);
  console.log(`  base:     ${BASE}`);
  console.log(`  escrow:   ${ESCROW} atto`);

  const server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript({ content: initWallets() });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  page.on("console", (message: any) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/status of (404|429)\b/.test(text)) return;
    if (/Rate limit exceeded: \d+ requests per (minute|hour)/i.test(text)) return;
    const url = message.location()?.url;
    consoleErrors.push(url ? `${text} (${url})` : text);
  });
  await page.exposeFunction("__observaSendTx", signAndSend);

  let dealId = "";
  try {
    section("1. landing + wallet discovery");
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await must(page.getByRole("button", { name: /connect wallet/i }), "landing renders the connect button");
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await must(page.getByRole("dialog"), "EIP-6963 chooser opens");
    await must(page.getByRole("button", { name: /Observa Client/i }), "the client wallet is announced");
    await page.getByRole("button", { name: /Observa Client/i }).click();
    await page.waitForFunction(() => !document.body.innerText.includes("Connect wallet"), null, { timeout: 30_000 });
    check("the client wallet connects over EIP-6963", true);

    section("2. open a deal through the form");
    await page.goto(`${BASE}/open`, { waitUntil: "domcontentloaded" });
    await must(page.getByRole("heading", { name: /open an uptime deal/i }), "open form renders");
    await page.getByLabel("Provider", { exact: true }).fill(providerAccount.address);
    await page.getByLabel("Service", { exact: true }).fill("E2E public endpoint");
    await page.getByLabel("Probe path", { exact: true }).fill("https://example.com");
    await page.getByLabel("Unit", { exact: true }).selectOption("minutes");
    await page.getByLabel("Window", { exact: true }).fill("3");
    await page.getByLabel("Slots", { exact: true }).fill("1");
    await page.getByLabel("Uptime target %", { exact: true }).fill("99");
    await page.getByLabel("Min coverage %", { exact: true }).fill("50");
    let opened = false;
    for (let attempt = 1; attempt <= 3 && !opened; attempt += 1) {
      await page.getByRole("button", { name: /open the deal/i }).click();
      try {
        await page.waitForURL(/\/deal\/s\d+$/, { timeout: 180_000 });
        opened = true;
      } catch {
        const body = await page.locator("body").innerText();
        if (!/rate-limit|rate limit/i.test(body)) break;
        console.log("   rate limited; retrying open in 20s");
        await sleep(20_000);
      }
    }
    check("openDeal navigates to the new deal", opened);
    if (!opened) throw new Error("openDeal did not navigate");
    dealId = page.url().split("/").pop() ?? "";
    check("the new deal has an id", /^s\d+$/.test(dealId), dealId);
    await must(page.getByText("OPEN", { exact: true }).first(), "the new deal reads OPEN");

    section("3. fund, switch wallet, start, and probe");
    await page.getByLabel("Amount (GEN)", { exact: true }).fill("0.01");
    await writeStep(
      page,
      page.getByRole("button", { name: /fund escrow/i }),
      page.getByText("FUNDED", { exact: true }).first(),
      "the deal reads FUNDED",
      480_000,
    );

    await page.locator("header button").filter({ hasText: "0x" }).first().click();
    await page.getByRole("button", { name: /disconnect/i }).click();
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.getByRole("button", { name: /Observa Provider/i }).click();
    await must(page.getByRole("button", { name: /start monitoring/i }), "the provider sees Start monitoring");
    await writeStep(
      page,
      page.getByRole("button", { name: /start monitoring/i }),
      page.getByRole("button", { name: /record sample/i }),
      "the provider starts the window",
    );
    await writeStep(
      page,
      page.getByRole("button", { name: /record sample/i }),
      page.getByText("1/1", { exact: true }).first(),
      "slot 0 is observed",
    );

    section("4. settle, appeal, resolve, finalize");
    await must(page.getByRole("button", { name: /settle/i }), "settle appears after the window", 180_000);
    await writeStep(
      page,
      page.getByRole("button", { name: /settle/i }),
      page.getByRole("button", { name: /file appeal/i }),
      "the tentative verdict opens the appeal",
    );
    await writeStep(
      page,
      page.getByRole("button", { name: /file appeal/i }),
      page.getByRole("button", { name: /resolve appeal/i }),
      "the appealed deal is resolvable",
    );
    await writeStep(
      page,
      page.getByRole("button", { name: /resolve appeal/i }),
      page.getByRole("button", { name: /pay out escrow/i }),
      "finalize is offered after the appeal",
    );
    await writeStep(
      page,
      page.getByRole("button", { name: /pay out escrow/i }),
      page.getByText("FINALIZED", { exact: true }).first(),
      "the deal reads FINALIZED",
    );

    section("5. browser health");
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    check(
      "no unexpected console errors",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 2).join(" | "),
    );
    check("the wallet stayed on Studionet", page.url().startsWith(BASE), page.url());
  } catch (error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = path.join(ROOT, `frontend-e2e-${stamp}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log(`\n   screenshot: ${shot}`);
    check("E2E run completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (dealId) console.log(`  deal: ${dealId}`);
  process.exitCode = failed ? 1 : 0;
}

await main();
