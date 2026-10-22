# Observa

**Agentic SLA escrow for agentic commerce.** A client escrows GEN against a
provider's uptime commitment, and GenLayer validators release or refund it from
**decentralized slot probes** or a **monitor-attested report**.

Observa (Latin *observare* — to watch — joined with *servare* — to keep) is an
intelligent contract on [GenLayer](https://docs.genlayer.com): the chain itself
observes whether a service kept its promise, and settles the escrow accordingly.

## The idea

An agent buys an API from another agent and wants recourse if it goes down. A
plain smart contract cannot see the outside world; a plain backend that reports
uptime is a single trusted party. Observa splits the difference:

1. **Client escrows GEN** against machine-readable SLA terms (endpoint, window,
   slots, uptime target).
2. **Anyone probes** the committed endpoint once per monitoring slot. Validators
   independently fetch it and agree on `UP`/`DOWN`, so the submitter cannot fake
   the reading and each slot accepts exactly one result.
3. **Optionally, a monitor attests.** The monitor commits `sha256(canonical_json(
   report))` on-chain, then publishes the report at an HTTPS URL. Validators
   refetch and re-hash; a report whose bytes no longer match the commitment is
   rejected. The on-chain digest is what stands in for a signature the VM cannot
   verify.
4. **Settlement is deterministic.** Measured uptime (integer bps) maps to a
   release share — `10000` when the target is met, else `10000 * uptime // target`
   — with no model in the loop. `MET` pays the provider; `BREACHED` splits the
   escrow.
5. **A tentative verdict can be contested.** `settle` writes the verdict and opens
   an appeal window without moving money. Either party may stake a bond to appeal;
   the verdict is then re-derived from the freshest evidence (late probes plus a
   re-published, re-committed attested report). The loser forfeits the bond, and
   `finalize` decides the split and creates payout obligations.

Probes win only when at least one slot was probed **and** coverage clears the
terms' `min_coverage_bps`; otherwise the attested reading is used. A thin probe
sample with no attestation is not authoritative, so `settle` reverts and the
client can `claim_lapsed` after a grace, so funds can never be stuck.

`finalize` and `claim_lapsed` decide the split; they do **not** assume the child
transfer arrived. A payout is `owed` -> `sent` -> `delivered`, one transfer may be
in flight at a time, and `lifetime_outflow`/`total_released`/`total_refunded` move
only when a balance snapshot confirms delivery.

## Lifecycle

```
OPEN --fund--> FUNDED --start--> ACTIVE --settle--> RESOLVED --appeal--> APPEALED
                                                       |                   |
                                                       |          resolve_appeal
                                                       |                   |
                                                       +-------> RESOLVED <+
                                                                   |
                                                              finalize
                                                                   |
                                                              FINALIZED (MET | BREACHED)

ACTIVE --cancel (pre-start) / claim_lapsed--> REFUNDED
```

## Contract surface

`contracts/observa.py` — class `Observa`, **11 view + 16 write** methods.

Writes: `open_deal`, `fund_deal` (payable), `start_deal`, `cancel_deal`,
`probe_slot`, `commit_attestation`, `submit_attestation`, `settle`,
`appeal` (payable), `resolve_appeal`, `finalize`, `claim_lapsed`,
`pump_payouts`, `retry_payout`, `recover_payout`, `confirm_payout`.

Views: `get_deal`, `get_terms`, `get_monitor_log`, `get_deal_audit`,
`get_deal_ids`, `get_deal_count`, `get_config`, `get_stats`, `get_log`,
`get_payouts`, `get_pending_payouts`.

### Terms JSON

```json
{
  "service": "Acme Payments API",
  "endpoint": "https://api.acme.example/health",
  "window_seconds": 86400,
  "slots": 24,
  "uptime_target_bps": 9900,
  "min_coverage_bps": 5000,
  "expect_status": 0,
  "monitor": "0x…",
  "attestation_url": "https://attest.example/reports/acme.json"
}
```

Required: `service`, `endpoint` (https), `window_seconds`, `slots` (1..720, with
`window_seconds >= slots`), `uptime_target_bps` (1..10000). Optional:
`min_coverage_bps` (default 5000), `expect_status` (0 = any 2xx), and the
`monitor` + `attestation_url` pair. The canonical JSON is digested into the deal,
so the exact bytes both parties agreed to are provable.

The monitor's report is canonical JSON such as:

```json
{"nonce": "att-1", "service": "Acme Payments API", "uptime_bps": 9900}
```

## Development

```powershell
# Lint the contract
genvm-lint check contracts/observa.py --json

# Fast in-process tests (mocked web)
python -m pytest tests -q

# Style
python -m ruff check .

# Real consensus on Studionet (includes a real web fetch)
gltest tests/integration -v -s --network studionet

# ...including the ~2-minute wait-out-a-window settlement test
gltest tests/integration -v -s -m slow --network studionet
```

Frontend contract-surface checks run in Node:

```powershell
npm run test:sync             # no network: methods, constants, canonical digest
npm run test:frontend         # live reads against the deployed contract
npm run test:frontend:write   # adds a reverting write + tx-phase assertions
npm run test:frontend:full    # full probe/settle/appeal/finalize path (needs keys)
npm run test:frontend:e2e     # Chrome + injected EIP-6963 wallets, full UI path
```

The browser E2E needs a production build (`npm --prefix frontend run build`),
Chrome (or `CHROME_PATH`), and both wallet keys. It starts the built app on port
`3100`, backs off on Studionet rate limits, and leaves the finished deal on chain.

The runner is pinned in the first line of the contract; the network rejects
`test`/`latest` aliases. See `AGENTS.md` for durable design notes.

## Studionet deployment

The deploy driver lives in `scripts/studionet.cjs`: browser-like User-Agent,
request pacing/backoff, receipt-hash matching, and a leader-receipt check so a
`FINALIZED` rollback is not mistaken for success.

```powershell
Copy-Item .env.example .env
# Set DEPLOYER_PRIVATE_KEY, or use the project wallet's GENLAYER_DEV_KEY.
npm run deploy:dry
npm run deploy

# Exercise a real probe, a bonded appeal, finalize and payout delivery.
npm run demo -- --address 0x...
npm run verify
```

Keys are read from the environment, `OBSERVA_KEY_FILE` / the project wallet
`D:\Genlayer-project\wallet\.env`, and the provider from `OBSERVA_SELLER_KEY` /
`seller.json`. No key is written into this repository.

Current deployment:

| network | contract | deploy tx |
| --- | --- | --- |
| Studionet (`61999`) | `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d` | `0xd873cfa9f034ea0994f62ef4f8f56e6831f6a0225f194658bf210f6edc05c3f7` |

The demo creates `s1` (probe, settle, appeal, finalize) and `s2` (cancel/refund)
on that instance. `npm run verify` deploys a fresh contract and checks both money
paths, including payout delivery, against real consensus.

## Frontend

`frontend/` is a Next.js 16 + React 19 + Tailwind v4 app that speaks to a deployed
Observa contract through a same-origin `/api/rpc` proxy (browser UA, `no-store`).

```powershell
npm --prefix frontend install
Copy-Item frontend/.env.example frontend/.env.local
npm --prefix frontend run dev     # http://localhost:3000
npm --prefix frontend run build
npm --prefix frontend run lint
```

Set `NEXT_PUBLIC_OBSERVA_ADDRESS` in `frontend/.env.local` to the deployed address
above. With it empty the app renders a setup notice and disables writes; no
address is hardcoded in the app.

Routes: `/` (landing), `/market` (ledger + filters), `/open` (terms form with a live
canonical digest), `/deal/[id]` (verdict, slot strip, audit, actions). Wallets are
discovered via **EIP-6963** (MetaMask, Rabby, …) on chain `61999`; the typed surface
in `frontend/src/lib/observa.ts` mirrors all 27 methods and reproduces the report
digest in the browser so the UI can show exactly what the monitor committed. The
deal view also exposes the payout ledger, including pending delivery, retry,
recovery and permissionless confirmation.

The visual system is an editorial "observation ledger": Newsreader display,
Schibsted Grotesk body, Azeret Mono data, warm ink and bone with sage/ochre/clay
signals. A real three.js terrain is fixed behind every route, dimmed by scrims and
grain so cards and long-form copy stay legible while the field moves with the page.

## Trust model (read this)

- Slot probes trust the committee's fetch at slot times; a slot that nobody
  probes on time is simply unobserved, so coverage is best-effort. A thin sample
  is not authoritative even if every probed slot was `UP`; the `min_coverage_bps`
  floor decides when probes win.
- The attestation path trusts the named monitor. There is no on-chain signature
  verification; the monitor's on-chain digest commitment is the binding. A monitor
  may re-commit a corrected report during the appeal window, so the bond protects
  contested verdicts, not against a monitor that changes its own report.
- A health endpoint is not the same as real user experience: a provider can run a
  health route that is up while the product is down. Observa therefore prefers to
  probe the real service route, and the bonded appeal is the implemented mitigation
  for a reading either party believes is wrong.

## Appeal economics

- `APPEAL_WINDOW_SEC = 3600`: how long a tentative verdict waits for a challenge.
- `APPEAL_BOND_BPS = 2500`, `MIN_APPEAL_BOND_ATTO = 10**15`: the bond is 25% of the
  escrow, floored so a dust escrow cannot make an appeal free.
- During the window, late probes and a corrected (re-committed) attestation are
  admissible. A different committed digest clears the old recorded reading; it must
  be resubmitted (or refreshed during `resolve_appeal`/`finalize`) before it can be
  used again.
- `resolve_appeal` re-derives the verdict; the appellant wins the bond only if the
  verdict actually moved in their favour, otherwise they forfeit it to the
  counterparty. If the source is unavailable and the recorded evidence cannot be
  refreshed, the tentative verdict stands and the bond is returned instead of
  leaving the deal stuck in `APPEALED`.

## Payout delivery

- A decided obligation is not a delivered payment. `finalize`/`claim_lapsed` writes
  the split and emits the first transfer; the payout stays `sent` until
  `confirm_payout` observes the value leave.
- Only one payout may be in flight. That makes the platform's id-less failed-value
  callback attributable. A failure returns the row to `owed`; the beneficiary may
  `retry_payout`, and `pump_payouts` sends the next obligation.
- If an attempt is stuck without a callback, `recover_payout` returns it to `owed`
  after `PAYOUT_GRACE_SEC` (3600s). `confirm_payout` is permissionless. Both are
  proofs from a balance snapshot, not caller claims.
- `held_atto` includes pending obligations. `total_released`, `total_refunded`,
  `lifetime_outflow`, and `deal.paid_atto` move only on delivery, so conservation
  stays checkable while funds are still in transit.

## License

MIT.
