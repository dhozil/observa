# AGENTS.md — Observa

Durable project notes for agents working in this repo. **Read this first.**
This project is expected to run long, so this file is the single source of truth
for *what we decided*, *what is done*, and *what comes next*. Keep it updated at
the end of every work session.

---

## 0. Prime directive — follow the GenLayer docs, do not improvise

Observa is a GenLayer **intelligent contract**. Everything here must follow the
official patterns. When in doubt, **stop and consult the docs / skills before
writing code** — do not invent APIs, do not "improve" the platform's conventions.
The whole point is that a GenLayer engineer should recognise this as idiomatic.

### Read before you build
- Landing: <https://docs.genlayer.com>
- Protocol & mental model: `/understand-genlayer-protocol`, `/understand-genlayer-protocol/typical-use-cases`
- Contracts: `/developers/intelligent-contracts/introduction`
- Equivalence: `/developers/intelligent-contracts/equivalence-principle`
- When to use: `/developers/intelligent-contracts/when-to-use-genlayer`
- Features: `/features/web-access`, `/features/value-transfers`, `/features/messages`, `/features/transaction-context`
- Storage: `/developers/intelligent-contracts/storage`
- Tooling & testing: `/tooling-setup`, `/developers/decentralized-applications/project-boilerplate`, `.../testing`
- Security: `/security-and-best-practices/prompt-injection`

### Non-negotiable rules (learned, verified, do not relearn the hard way)
1. **Pin the runner** in line 1. Never `test`/`latest`/unversioned. Family pin:
   `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }`
2. **Lint every contract change**: `genvm-lint check <file> --json` must be green.
3. **Storage types only**: `TreeMap`, `DynArray`, `u256`/`u64`/`i64`, `Address`,
   `str`, `bool`, `@allow_storage @dataclass`. No `dict`/`list`/bare `int`/`float`.
4. **No wall clock / no cron.** Time comes from the tx-pinned `datetime.now(...)`
   (the direct harness can `warp` it). Monitoring must be tx-triggered.
5. **Nondeterminism only inside a nondet block** (`gl.nondet.web.*`,
   `gl.nondet.exec_prompt`). Validators must re-derive independently.
6. **Equivalence default** = `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` with
   a comparison of *stable decision fields only*; never leader-output-only checks.
   Use `strict_eq` only for deterministic calls.
7. **Error prefixes** `[EXPECTED]`/`[EXTERNAL]`/`[TRANSIENT]` (+`[LLM_ERROR]`) and
   the shared `_verify`/`_handle_leader_error` pair. Error text that must agree
   across validators is **static** (no variable content in the message).
8. **Value**: `u256` atto; receive via `@gl.public.write.payable` + `gl.message.value`;
   pay via `emit_transfer(value=u256(...))` on `finalized`. Money invariant is
   *checkable*: `held_atto == lifetime_inflow - lifetime_outflow`.
9. **Integers only** in storage and money math: `int(...)` then `//`.
10. **Verify with three gates**: `genvm-lint` → direct `pytest` → `gltest
    tests/integration --network studionet`. Do not claim "done" without them.
11. **Mirror the family** (sibling repos, especially `Agentic-marketplace-disputes`)
    for structure, naming, comments and driver code.
12. **Never commit secrets.** Wallet keys live outside the repo.

---

## 1. What this is
GenLayer "agentic SLA escrow" for agentic commerce: a client escrows GEN against a
provider's uptime commitment, and GenLayer validators release or refund it from
**decentralized slot probes** or a **monitor-attested report**. Repo folder stays
`D:\Genlayer-project\SLA-and-uptime-enforcement` (do not rename it).

Product name: **Observa** (Latin *observare* — to watch — joined with *servare* —
to keep/preserve the escrowed funds).

## 2. Layout
- `contracts/observa.py` — the intelligent contract (class `Observa`).
- `tests/conftest.py` — direct-mode fixtures/helpers (only one conftest; see below).
- `tests/test_observa.py` — direct-mode tests.
- `tests/test_invariants.py` — randomized conservation + evidence-race tests.
- `tests/integration/test_consensus.py` — Studionet consensus tests.
- `tests/frontendSync.ts` — offline contract/frontend surface parity.
- `tests/frontendIntegration.ts` — live frontend readers/writers (`--write`, `--full`).
- `tests/frontendE2E.ts` — Chrome + injected EIP-6963 wallets, full UI path.
- `gltest.config.yaml`, `pyproject.toml`, `.gitignore` — test tooling config.
- `scripts/studionet.cjs` — Node RPC driver (pacing, backoff, receipt guard).
- `deploy/{deployScript,demoScript,verifyScript}.ts` — deploy, end-to-end demo,
  and full on-chain verification.
- `package.json`, `.env.example` — root driver scripts and key/address template.
- `README.md` — the human-facing explanation, deployment and trust model.
- `frontend/` — Next.js 16 + React 19 + Tailwind v4 app (Phase 3).
  - `src/lib/{genlayer,eip6963,observa,format,utils}.ts` — client, wallet
    discovery, typed contract surface, formatting.
  - `src/components/ui/progressive-hero.tsx` — the landing hero (CSS word cycle +
    live slot strip); `src/components/site-background.tsx` — fixed global scene,
    scrims and grain; `src/components/{signal-field-3d,signal-field}.tsx` — WebGL
    (three.js) terrain and its 2D fallback; `src/components/reveal.tsx` — no-JS-safe
    scroll reveal.
  - `src/components/deal/deal-ledger.tsx` — shared ledger rows (landing + market);
    `src/components/deal/{status-badge,deal-card}.tsx` — status and legacy card.
  - `src/app/globals.css` — design tokens, Newsreader / Schibsted Grotesk / Azeret
    Mono fonts, word cycle, grain, reveal and entrance utilities.
  - `src/components/wallet/{wallet-context,wallet-button}.tsx` — EIP-6963 chooser.
  - `src/app/{page,market,open,deal/[id]}` + `src/app/api/rpc/route.ts`.
  - `src/hooks/{use-contract,use-tx,use-now}.ts` — reads, tx phases, ticking clock.
  - `.env.example` — `NEXT_PUBLIC_OBSERVA_ADDRESS` (empty template; `.env.local`
    holds the live Studionet address).

## 3. Commands (Windows, PowerShell 7)
- Lint contract: `genvm-lint check contracts/observa.py --json` (always `--json`;
  the human output crashes on U+2713 in cp1252).
- Direct tests: `python -m pytest tests -q`.
- Ruff: `python -m ruff check .`.
- Integration (fast, real consensus incl. a real web probe, no model):
  `gltest tests/integration -v -s --network studionet`.
- Integration (incl. the ~2-min wait-out-a-window settle test):
  `gltest tests/integration -v -s -m slow --network studionet`.
- Deploy: `npm run deploy:dry`, `npm run deploy`; demo: `npm run demo -- --address
  0x…`; on-chain verification: `npm run verify`.
- Frontend contract tests: `npm run test:sync` (offline), `npm run test:frontend`
  (live reads), `npm run test:frontend:write` (revert/phases), and
  `npm run test:frontend:full` (full escrow path; needs both keys).
- Browser E2E: build first (`npm --prefix frontend run build`), then
  `npm run test:frontend:e2e` (Chrome/`CHROME_PATH`, both keys, port `3100`).
- Frontend: `npm --prefix frontend install`, `npm --prefix frontend run dev`,
  `npm --prefix frontend run build`, `npm --prefix frontend run lint`.

## 4. Durable facts / decisions
- Live Studionet deployment: `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d`
  (deploy tx `0xd873cfa9f034ea0994f62ef4f8f56e6831f6a0225f194658bf210f6edc05c3f7`);
  it holds demo deals `s1`/`s2`, the frontend `--full` deal `s3`, and E2E
  artifacts `s4..s12` (early rate-limit retries left some
  ACTIVE/FUNDED/RESOLVED/APPEALED; `s12` is the green FINALIZED browser run).
  `frontend/.env.local` (ignored)
  points at it.
- First line of the contract pins the runner `1jb45…` (the network rejects
  `test`/`latest`; genvm-lint notes a newer runner but the family stays on `1jb45…`
  for consistency).
- **Import style follows the pinned runner, not the newest SDK.** The v0.3.0-rc10 SDK
  migrated to `import genlayer as gl` + `gl.contract.Contract`, but the `1jb45…`
  runner (and every family sibling) uses the lazy `from genlayer import *` +
  `gl.Contract` star-import. Do NOT migrate import style unless the runner is bumped.
- 27 methods = 11 view + 16 write, ctor has no params. Deal ids are `s` + count, so
  `s1..sN`.
- Lifecycle: `OPEN -> FUNDED -> ACTIVE -> RESOLVED -> [APPEALED -> RESOLVED] -> FINALIZED`
  (or `REFUNDED`). Outcomes: `MET`, `BREACHED`.
- **Deterministic settlement — no LLM.** The only non-determinism is the web fetch;
  `release_bps` is computed by integer arithmetic from the measured uptime. This is
  deliberate: fewer error modes than a prompt-based adjudication.
- Consensus via `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` with the shared
  `_verify`/`_handle_leader_error` pair.
- Probe equivalence compares ONLY `s` (`"UP"`/`"DOWN"`). `http`/`reachable` are
  audit-only. Attestation equivalence compares `uptime_bps` (bytes are already
  bound by the committed digest).
- No cron: `probe_slot(deal_id, slot)` is permissionless, one probe per slot, valid
  from `start + slot*slot_seconds` until `+slot_seconds + PROBE_GRACE_SEC`.
  Nobody probes ⇒ nobody observes.
- Attestation path: the `monitor` named in terms calls `commit_attestation(deal_id,
  digest, nonce)` with `sha256(canonical_json(report))`; then `submit_attestation`
  fetches `attestation_url` and a validator that hashes the fetched report to a
  different digest rejects it. **There is no on-chain signature check** — the
  on-chain digest commitment stands in for a signature (trust the monitor).
- Settlement source: probes win only when `probed_slots > 0` **and** coverage ≥
  `min_coverage_bps`; otherwise the attested reading is used. A thin sample with no
  attestation is not authoritative, so `settle` reverts and the client can
  `claim_lapsed` after `LAPSE_GRACE_SEC` (inconclusive refund).
  `release_bps = 10000` when `uptime >= target`, else `10000 * uptime // target`.
- **Delivery-aware payouts (P0, done).** `finalize`/`claim_lapsed` decide the split
  and create per-deal payout rows; they do not assume the child transfer arrived.
  States are `owed -> sent -> delivered`, with only one global in-flight transfer
  (the platform callback has no id). `lifetime_outflow`, `total_released`,
  `total_refunded`, and `deal.paid_atto` move only on confirmed delivery; `held_atto`
  includes pending obligations. Writes: `pump_payouts`, `retry_payout` (beneficiary
  only), `recover_payout` (after `PAYOUT_GRACE_SEC`), `confirm_payout` (permissionless).
  Views: `get_payouts`, `get_pending_payouts`.
- **Two-phase settlement + bonded appeal (Phase 4, done).** `settle` writes a
  *tentative* verdict and opens an appeal window; no money moves. `appeal` (payable,
  either party) stakes `max(escrow*APPEAL_BOND_BPS//10000, MIN_APPEAL_BOND_ATTO)` and
  marks the deal `APPEALED`. `resolve_appeal` re-derives with `refresh_attestation=True`
  (re-fetches the report against the current committed digest) and marks `final=True`.
  `finalize` decides the standing verdict and settles the bond (loser forfeits it to
  the counterparty) by creating payout rows; with no appeal it recomputes from all
  recorded evidence, so late probes and a corrected attestation count. During an open appeal window (status `RESOLVED` not final, or
  `APPEALED`) `probe_slot`, `commit_attestation` and `submit_attestation` are
  re-admitted — the monitor may publish + re-commit + submit a corrected report.
  A changed digest clears the previously recorded reading (`attested=False`), because
  it no longer describes the committed bytes. If fresh evidence is unavailable
  (`gl.vm.UserError`), `resolve_appeal`/`finalize` keep the tentative verdict and set
  `appeal_evidence_unavailable`; the appeal bond is returned to the appellant rather
  than forfeited. This is the P1 liveness path. Probe-based verdicts are
  decentralized and not contested by a bond (re-derivation is identical).
- Protocol constants (see also `get_config`): `MAX_SLOTS=720`,
  `PROBE_GRACE_SEC=300`, `LAPSE_GRACE_SEC=86400`, `DEFAULT_MIN_COVERAGE_BPS=5000`,
  `MIN_ESCROW_ATTO=1`, `APPEAL_WINDOW_SEC=3600`, `APPEAL_BOND_BPS=2500`,
  `MIN_APPEAL_BOND_ATTO=10**15`, `PAYOUT_GRACE_SEC=3600`, `MAX_LOG=500`.
- Terms JSON requires `service`, an https `endpoint`, `window_seconds`, `slots`
  (1..720, and `window_seconds >= slots`), `uptime_target_bps` (1..10000).
  Optional: `min_coverage_bps` (default 5000), `expect_status` (0 = any 2xx), and
  `monitor` + `attestation_url` (a `monitor` requires an https `attestation_url`).
- `get_log` returns a canonical JSON array of JSON-encoded strings — callers parse
  twice. `get_monitor_log` returns one entry per slot: `{"s","http"}` or `null`.
- Ruff ignores the GenVM star-import style under `contracts/*`; genvm-linter owns
  contract style.
- **Frontend (Phase 3) facts.** Stack mirrors the family sibling: Next.js 16.4.2,
  React 19.3.0, Tailwind v4, genlayer-js ^1.1.8, plus `three` ^0.186 for the scene.
  The visual system is an "observation ledger": Newsreader display, Schibsted
  Grotesk body, Azeret Mono labels, warm bone/ink with sage (`signal`), ochre
  (`watch`) and clay (`loss`). `SiteBackground` keeps a real WebGL terrain fixed
  behind every route (`-z-20`), with a fixed scrim/telemetry grid (`-z-10`) and grain
  (`z-50`); `html` owns the base color and `body` is transparent. Cards use
  `bg-panel/85 backdrop-blur-[3px]` and sharp corner ticks so copy stays legible.
  No framer-motion; motion is CSS + `IntersectionObserver`.
- `.reveal` is visible by default (no-JS safe). `Reveal` only arms elements below the
  fold; in-view content is shown immediately and the observer marks the rest.
- The hero word cycle is a **precise sliding reel**: one 1.3em viewport, a vertical
  track that moves by whole-line steps on a 10.5s loop, with a ~1s eased slide and
  a 1.15em spacer between words. Per-word opacity keyframes hide the outgoing word
  just as it leaves the viewport and reveal the next only once it starts to enter,
  so two halves are never legible at once. The last word duplicates the first for a
  seamless wrap. A 7% mask fades the viewport edges so partial glyphs are not
  clipped. Reduced motion shows only `watched.`.
- Header active nav comes from `window.location` in an effect (not `usePathname`),
  with `popstate` + document click listeners keeping it in sync. This avoids
  suspending the partial-prerender `/deal/[id]` shell. `useParams` still sits under
  `<Suspense>`.
- Chrome headless enforces a **~512px minimum viewport width**. Use 512px for the
  small layout; `--window-size=390` is cropped, not a real 390px render.
- Deal polling is budgeted for Studionet: status every 30s, payouts every 60s,
  audit every 120s (the old 3 x 20s alone exceeded the 500/hour cap). Browser reads
  also pass a 24/min shared budget with a 429 cooldown; the deal view no longer
  loads `get_deal_ids`, and the read timeout is 40s. Node/gltest runs are not paced.
  Writes call `refreshAll` on success, so actions still update immediately.
- Reads/writes are env-driven: `NEXT_PUBLIC_OBSERVA_ADDRESS` (empty in
  `.env.example`; the live address is in ignored `.env.local`). `isConfigured`
  gates every read/write and the UI shows a setup notice when it is unset. Never
  hardcode an address in app code.
- Wallet = **EIP-6963 only** (`observa.wallet.rdns`, silent `eth_accounts` reconnect),
  no `window.ethereum`. RPC goes through the same-origin `/api/rpc` proxy (browser
  UA; `no-store`), chain `61999`; `ensureChain` offers `wallet_addEthereumChain`.
- `cacheComponents` + `partialPrefetching` are on. `useParams()` must sit under
  `<Suspense>` (see `deal/[id]/page.tsx` wrapping `deal-view.tsx`), otherwise the
  prerender errors.
- The typed contract surface reproduces the 27 methods and the canonical report
  digest in the browser (`canonicalJson` + WebCrypto SHA-256 must match Python's
  `json.dumps(sort_keys=True, separators=(",", ":"))`). The deal view includes the
  payout ledger and delivery actions; `evidenceSource`/`hasEvidence` require
  authoritative probe coverage, not merely `probed_slots > 0`.
- Tx UI ignores `FINALIZED` as success: `waitForReceipt` inspects
  `consensus_data.leader_receipt` for an execution error and `humanizeError` maps
  `[EXPECTED]`/`[EXTERNAL]`/`[TRANSIENT]`/`[LLM_ERROR]` to plain copy.

## 5. Testing notes
- One `conftest.py`, at `tests/`. A second under `tests/integration/` would both
  import as `conftest` and raise an import-file-mismatch; the network rails live at
  the top of `test_consensus.py` instead.
- `tests/integration` staging copies the contract into `contracts/.integration/`
  per deploy (a local simulator only honours `@allow_storage` on a fresh module).
- Direct-mode web mocks are regex on the URL (`api\.example\.org` for the endpoint,
  `attestor\.example\.net` for the report).
- Browser E2E (`tests/frontendE2E.ts`) uses `playwright-core` with system Chrome
  (no browser download), injects two EIP-6963 providers that sign via viem, runs
  `next start` on port `3100`, and retries both the 30/min and 500/hour limits.
  It treats 404/429 resource errors and GenLayer rate-limit console logs as
  expected environmental noise, not app failures.
- Studionet: chain id `61999` (`0xf22f`), `https://studio.genlayer.com/api`, GEN 18
  decimals, gasless. gltest reaches it via `requests` (a raw urllib probe hits
  Cloudflare error 1010). Rate limits ~30–60/min.
- Symmetry rule for slot tests: probes are timed by `slot_seconds`; open/fund/start
  all happen at `BASE_DT`, so slot `i` opens at `BASE_DT + i*slot_seconds`.
- `settle` no longer moves money. Use `settle_and_finalize(...)` (waits
  `APPEAL_WINDOW_SEC`) for the un-appealed path, or `file_appeal(...)` +
  `resolve_appeal` + `finalize` for the bonded path. `settle_and_finalize` confirms
  all payouts via `confirm_all_payouts`; bond payouts are *not* in
  `total_released`/`total_refunded` (escrow split only); `lifetime_outflow` and
  `conserved` verify them.
- Payout tests set the host contract balance with `sync_contract_balance(...)` to
  `Payout.balance_at_emit - amount_atto` before `confirm_payout`; this simulates the
  child transfer leaving. Integration tests accept a still-`sent` row because the
  real child transfer is asynchronous.

## 6. Roadmap / plan (detailed)
Status legend: [x] done · [~] in progress · [ ] planned · [ ]? open question.

### Phase 0 — Foundations (DONE)
- [x] Read GenLayer docs + load the `write-contract`, `genvm-lint`, `direct-tests`,
  `integration-tests`, `genlayer-cli` skills.
- [x] Study the family sibling `Agentic-marketplace-disputes` (escrow + appeal) and
  `paramatic-insurance` (web-fetch consensus) for conventions.
- [x] Pick product name + model: **Observa**, hybrid **slot probes + attestation**.
- [x] Skeleton: `pyproject.toml`, `gltest.config.yaml`, `.gitignore`, `README.md`.

### Phase 1 — Contract + tests (DONE)
- [x] Write `contracts/observa.py` (18 methods at the time; **27** after Phase 4 and
  P0 delivery work, deterministic settlement).
- [x] Direct suite `tests/test_observa.py` (**54 tests**) +
  `tests/test_invariants.py` (**4 tests**) + `tests/conftest.py`.
- [x] Integration suite, verified on Studionet (5 fast + 1 slow).

### Phase 2 — Deploy tooling (DONE)
- [x] `scripts/studionet.cjs`: browser UA, pacing/backoff, receipt-hash guard,
  `FINALIZED` ≠ success (inspects `consensus_data.leader_receipt`).
- [x] `deploy/deployScript.ts` (+ `--dry-run`), `demoScript.ts`, `verifyScript.ts`.
- [x] `package.json` scripts (`deploy`, `deploy:dry`, `demo`, `verify`), root
  `.env.example`, key-temp cleanup, `.gitignore` hardening.
- [x] First real deployment: Studionet `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d`
  (tx `0xd873cfa9f034ea0994f62ef4f8f56e6831f6a0225f194658bf210f6edc05c3f7`).
  Demo created `s1`/`s2`; verification deployed
  `0xC14ab3f10cC8FF258aFA69e7f5F30aBa6f5538af` and passed **26/26** checks.

### Phase 3 — Frontend (DONE)
- [x] Next.js 16 + React 19 + Tailwind v4 app under `frontend/`.
- [x] `frontend/src/lib/genlayer.ts` (genlayer-js client, `chains.studionet`) and a
  contract surface module `frontend/src/lib/observa.ts`.
- [x] Same-origin `/api/rpc` proxy (CORS), EIP-6963 wallet chooser, tx-phase UI
  (`signing → waiting → confirmed`), stale-receipt guard, `humanizeError`.
- [x] Routes: market/list, deal detail (monitor log + verdict), open deal.
- [x] Themed hero: fixed global WebGL field + CSS word cycle, live slot strip,
  wallet.
- [x] Full visual overhaul: editorial observation-ledger shell, ledger tables,
  timeline, market/open/deal layouts, responsive 512px layout.
- [x] Production build + runtime smoke (`/`, `/market`, `/open`, `/deal/s1` → 200;
  unconfigured state degrades to a setup notice).
- [x] Coverage-floor and payout-delivery UI: authoritative-evidence badge, thin
  coverage as inconclusive, payout ledger with `owed`/`sent`/`delivered`, retry,
  recover, confirm and pump actions.
- [x] Tests: `frontendSync.ts` (55 offline checks) + `frontendIntegration.ts`
  (read-only, `--write`, and `--full`) + `frontendE2E.ts` (20 browser checks).

### Phase 4 — Protocol depth (IN PROGRESS)
- [x] Bonded challenge/appeal round: after a tentative verdict, a party stakes a
  bond and the verdict is re-derived (re-fetched attestation + any late probes);
  loser forfeits the bond. Mirrors `sacramentum`'s appeal mechanics. DONE:
  `settle → [appeal → resolve_appeal] → finalize`.
- [x] Coverage authority (P0): probes need `probed_slots > 0` and coverage at or
  above `min_coverage_bps`; thin coverage without an attestation is a lapse refund,
  not a verdict. Direct tests cover the exact floor and one-bps-below cases.
- [x] Delivery-aware payouts (P0): decided obligations are tracked until a balance
  snapshot proves delivery; single global in-flight; failed attempts retryable.
- [x] P1 appeal timeout / evidence binding: a re-commit clears stale readings;
  `submit_attestation` is admissible during an appeal; when fresh evidence cannot be
  fetched, `resolve_appeal`/`finalize` keep the tentative verdict, flag
  `appeal_evidence_unavailable`, and return the appeal bond instead of leaving the
  deal stuck in `APPEALED`.
- [ ] `expect_status` / status-class policies beyond 2xx (e.g. acceptable 200/204).
- [ ] Latency SLA: needs tolerance or external attestation — probes cannot measure
  user-perceived latency reliably. Design before coding.
- [ ] Third-party monitor allowlist + multiple attestations (median) to reduce
  single-monitor trust. (The appeal bond is the current mitigation.)
- [ ] Negative-slot semantics: define whether a missed slot counts as UP/DOWN/excluded
  (currently: unobserved, and `min_coverage_bps` gates probe authority).

### Phase 5 — Hardening (DONE)
- [x] Property/invariant tests for conservation across randomized paths (incl. bond
  payouts, which are intentionally outside `total_released`/`total_refunded`).
- [x] Adversarial tests: provider front-running probes, monitor re-commit races,
  client refund vs attestation race.
- [x] Re-read the GenLayer security/prompt-injection notes; confirm boundaries
  (see §10.5).

### Open questions (resolved from the docs — see section 10)
- [x] **Signature primitive?** NO `ecrecover` in the SDK (only `Keccak256`). But the
  monitor's `commit_attestation` tx is authenticated by its EVM key, so the on-chain
  digest commitment *is* the signature. Optional upgrade: verify an arbitrary
  off-chain signature via `gl.nondet.web.request` → EVM `eth_call` inside a nondet
  block (`strict_eq`), as in the skill's cross-chain RPC pattern.
- [x] **Two-phase settle?** YES — done: `settle` (tentative, no money) → `appeal`
  (bond) → `resolve_appeal` (re-derive) → `finalize` (decide + create payouts;
  delivery is confirmed asynchronously).
- [ ]? Exact UX for "who probes" (a permissionless keeper bot in `scripts/`?).

## 7. Activity log
Newest first. One entry per work session: date, what was done, evidence (commands +
results). Keep it short but concrete.

- **2026-10-21 — Browser read pacing (429 console noise).**
  - Added a browser-only 24/min read budget with a shared 429 cooldown, so a
    multi-hook page load cannot burst past Studionet's 30/min ceiling. Node/gltest
    reads stay unpaced.
  - Dropped the unused `get_deal_ids` read from the deal view and raised the read
    timeout to 40s; 429 retries are capped at one backoff to avoid log storms.
  - Evidence: frontend `lint` clean; `build` green.

- **2026-10-21 — Browser E2E + Studionet rate-limit budget.**
  - Added `tests/frontendE2E.ts` and `npm run test:frontend:e2e`: the production
    build in real Chrome with two injected EIP-6963 wallets (viem signing), driving
    open -> fund -> start -> probe -> settle -> bonded appeal -> resolve -> finalize.
    **20 passed, 0 failed** (deal `s12`).
  - Hardened writes against the 30/min + 500/hour limits: signer retry with
    `retry_after_seconds`, outcome polling instead of blind re-clicks, backoff, and
    a 3-minute window. The first retry attempts left `s4..s11`; `s12` is green.
  - Cut deal-view polling from 3 x 20s to status 30s / payouts 60s / audit 120s;
    writes still call `refreshAll`, so actions update immediately.
  - Evidence: `npm run test:frontend:e2e` -> **20 passed**; frontend `lint` clean;
    `build` green; README/AGENTS updated.

- **2026-10-21 — Phase 5 randomized conservation + evidence races.**
  - Added `tests/test_invariants.py`: 20 seeded mixed lifecycles (cancel, probe
    settlement, bonded appeal with a late slot probe, attestation-only, and a
    thin/absent-probe lapse). After every deal the test asserts
    `held == inflow - outflow == owed + in_flight`, `conserved`, zero pending,
    delivered rows summing to escrow (+ bond), and cumulative released/refunded.
  - Adversarial cases: a lapse refund cannot be reversed by a late attestation
    commit; a recorded attestation blocks a lapse; a provider cannot backfill a
    closed slot or overwrite a probed one.
  - Re-read the official prompt-injection guidance: no LLM prompt exists, and the
    probe/attestation surfaces only yield a status or a digest-bound integer; the
    one residual boundary is arbitrary party-supplied HTTPS URLs (SSRF-style).
  - Evidence: `pytest tests` -> **58 passed, 6 skipped, 1 deselected**;
    `ruff` clean; `genvm-lint --json` ok (27 methods).

- **2026-10-21 — Frontend contract tests (sync + live + full path).**
  - Added `tests/frontendSync.ts`: parses the contract, checks all 27 methods and
    arities, payable surface, 10 protocol constants, status/outcome sets,
    coverage/evidence math, appeal bond sizing, and the canonical JSON digest
    against Python's output. **55 passed**.
  - Added `tests/frontendIntegration.ts`: read-only live reads (**18 passed**),
    `--write` revert/phases (**22 passed**), and `--full` open -> fund -> start ->
    probe -> settle -> bonded appeal -> resolve -> finalize through the exact
    frontend wrappers (**42 passed**, deal `s3`).
  - Added root `test:sync`, `test:frontend`, `test:frontend:write`,
    `test:frontend:full` scripts; documented the commands in README/AGENTS.
  - Evidence: frontend lint/build still green with the live `.env.local`.

- **2026-10-21 — Phase 2 deploy tooling + first real deployment (26/26 verify).**
  - Ported the family Studionet driver (`scripts/studionet.cjs`) and added root
    `package.json`, `.env.example`, `.gitignore` hardening for key temp files.
  - Wrote `deployScript.ts` (read-back checks), `demoScript.ts` (probe → settle →
    bonded appeal → finalize plus cancel/refund) and `verifyScript.ts` (fresh
    deploy, both money paths, payout delivery polling, invariants).
  - Deployed Studionet `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d`
    (tx `0xd873cfa9f034ea0994f62ef4f8f56e6831f6a0225f194658bf210f6edc05c3f7`);
    demo created `s1`/`s2`. Verification deployed
    `0xC14ab3f10cC8FF258aFA69e7f5F30aBa6f5538af` and passed **26/26**: deploy
    read-back, cancel refund, real probe UP, tentative MET, bonded appeal,
    finalize, `owed -> sent -> delivered` for provider/bond, `held == 0`,
    `conserved`, `inflow == outflow`, `released 5 GEN`, `refunded 2 GEN`.
  - Added the live address to ignored `frontend/.env.local`; README documents the
    deploy/demo/verify commands and the deployment table.
  - Next: frontendSync/frontendIntegration tests, then Phase 5 hardening.

- **2026-10-21 — P1 appeal liveness/evidence binding (all local gates green).**
  - A changed attestation digest now clears the old recorded reading; `submit_attestation`
    is admissible during an open appeal; `resolve_appeal`/`finalize` re-fetch a
    re-committed report.
  - If fresh evidence is unavailable (`gl.vm.UserError`), the tentative verdict stands,
    `appeal_evidence_unavailable` is set, and the bond is returned to the appellant
    instead of leaving the deal stuck in `APPEALED`.
  - Frontend exposes the flag in the verdict copy; README documents the re-commit and
    fallback rules.
  - Evidence: `genvm-lint --json` ok (**27 methods**); `pytest tests\test_observa.py
    -q` → **54 passed**; `pytest tests -q` → **54 passed, 6 skipped, 1 deselected**;
    `ruff` clean; `npm run lint` clean; `npm run build` green. Targeted Studionet:
    bonded appeal **passed** (111.73s) and slow settle **passed** (149.51s).
  - Next: optional full fast integration rerun when the rate-limit window allows;
    then Phase 2 deploy tooling or frontend tests.

- **2026-10-21 — P0 coverage floor + delivery-aware payouts (contract/direct/frontend green).**
  - Coverage: probes are authoritative only with `probed_slots > 0` and coverage at
    or above `min_coverage_bps`; thin coverage without an attestation now reaches
    `claim_lapsed` as an inconclusive refund. Added exact-floor and one-bps-below
    tests.
  - Payouts: per-deal `Payout` rows (`owed -> sent -> delivered`), single global
    in-flight transfer, balance-snapshot delivery, `__on_errored_message__` return,
    `pump_payouts`/`retry_payout`/`recover_payout`/`confirm_payout`, and
    `get_payouts`/`get_pending_payouts`. Totals move only on delivery.
  - Frontend: authoritative `evidenceSource`/`hasEvidence`, thin-coverage copy,
    payout ledger and delivery actions; `Deal` now carries `paid_atto`.
  - Integration tests now assert payout rows and conservation without assuming the
    asynchronous child transfer already landed.
  - Evidence: `genvm-lint --json` ok (**27 methods**); `pytest tests\test_observa.py
    -q` → **50 passed**; `ruff` clean; `npm run lint` clean; `npm run build` green.
    `gltest` fast suite hit Studionet's 30 req/min limit after the first test
    (1 passed, 5 rate-limited); targeted reruns passed `test_cancel_refunds_the_client`
    (63s) and `test_bonded_appeal_settles_by_consensus` (102s); slow
    `test_settle_after_a_short_window` passed (155s).
  - Next: P1 appeal timeout/evidence binding, then rerun the whole integration
    suite when the node's rate-limit window allows.

- **2026-10-20 — Typography pass + precise word cycle (build green).**
  - Replaced Instrument Serif / IBM Plex Sans / IBM Plex Mono with **Newsreader**
    (display, normal + italic), **Schibsted Grotesk** (body) and **Azeret Mono**
    (labels/data) — a less templated trio for the observation-ledger direction.
  - Rebuilt the hero verb as a **sliding reel**: a vertical track steps by whole
    lines inside a 1.3em viewport, words are separated by a 1.15em spacer, and
    per-word opacity hides the outgoing word at the halfway point and reveals the
    next — two words are never legible at once. The last word duplicates the first
    for a seamless wrap; a 7% edge mask keeps glyphs from clipping.
  - Added the reduced-motion fallback: first word only, no animation.
  - Retuned the reel after review: the slide is ~1s with `ease-in-out`
    (24→33.33%, 57.33→66.66%, 90.66→100%), so the track visibly moves instead of
    snapping. The opacity handoff happens exactly when the outgoing word has left
    the viewport, so the motion is readable and two words still never overlap.
  - Evidence: `npm run lint` clean; `npm run build` green; headless screenshots of
    `watched` / `kept` / `settled` states verified (no clipping or ghost glyphs).
  - Next: frontend tests or Phase 2 deploy tooling (ask first).

- **2026-10-20 — Frontend visual overhaul + fixed global 3D field (build green).**
  - Replaced the initial theme with an editorial "observation ledger": Instrument
    Serif / IBM Plex Sans / IBM Plex Mono, bone-on-ink palette with sage/ochre/clay,
    square plates, ruled ledgers and corner ticks. Avoids the generic neon-on-black
    AI look.
  - Moved the WebGL scene into `SiteBackground`: fixed at every route, dimmed by a
    fixed scrim/telemetry layer, with grain on top. Text-heavy sections use
    `text-veil`/opaque plates so the field stays visible without hurting copy.
  - Rewrote header/footer, hero, stats, cards, buttons, badges, fields, dialogs,
    slot strip, how-it-works timeline, deal ledger, market/open/deal layouts.
  - Removed `usePathname` from the header (partial-prerender shell was suspending
    the nav); switched to a location effect with `popstate`/click sync. Made
    `Reveal` no-JS-safe and masked the word cycle for italic descenders.
  - Evidence: `npm run lint` clean; `npm run build` green (7 routes, `/deal/[id]`
    partial-prerender); smoke `/`, `/market`, `/open`, `/deal/s1` → 200; Chrome
    screenshots at 1440px and 512px verified.
  - Next: frontend tests (`frontendSync`/`frontendIntegration`) or Phase 2 deploy
    tooling (ask first).

- **2026-10-20 — Phase 3 frontend built (build + smoke green).**
  - Scaffolded `frontend/` mirroring the family stack (Next 16.4.2 / React 19.3.0 /
    Tailwind v4 / genlayer-js ^1.1.8). Initial theme (superseded later this day):
    Bricolage Grotesque + Manrope + JetBrains Mono, canvas `SignalField`.
  - Typed contract surface for all 21 methods (+ canonical JSON/SHA-256 digest,
    constants, `nextProbeSlot`, `coverageBps`, `appealBondFor`, error humanizer);
    `/api/rpc` proxy; EIP-6963 wallet chooser; tx phases with leader-error detection.
  - Routes: landing (hero + stats + how-it-works + latest), market (search/status
    filters), open (terms form + digest preview + poll-for-id), deal detail
    (verdict, slot strip, audit, action panel, parties, economics). `useParams` is
    wrapped in `<Suspense>` for `cacheComponents`.
  - Config-gated UX: no address ⇒ setup notice + disabled actions (deal route shows
    the notice instead of a misleading load error).
  - Hero background replaced with a genuine WebGL 3D scene (three.js): shader
    terrain, scan sweep, camera drift, mint/amber motes; 2D canvas kept as the
    WebGL fallback. The earlier 2D-only version was a deliberate shortcut that did
    not match the prompt.
  - Evidence: `npm run lint` clean; `npm run build` green (7 pages; `/deal/[id]`
    partial-prerender); prod smoke `/`, `/market`, `/open`, `/deal/s1` → 200;
    Chrome screenshots at 1440px (and 512px small layout) verified.
  - Next: frontend tests (`frontendSync`/`frontendIntegration`) or Phase 2 deploy
    tooling (ask first).

- **2026-10-19 — Phase 4 bonded appeal (done, all gates green).**
  - Split `settle` into `settle` (tentative, opens `APPEAL_WINDOW_SEC`) → `appeal`
    (payable bond) → `resolve_appeal` (re-derive: re-fetch attestation + late probes)
    → `finalize` (pay escrow + settle bond). No-appeal `finalize` recomputes instead.
  - Re-admitted `probe_slot` / `commit_attestation` during the open appeal window so
    late probes and a corrected report count. Added `first_release_bps`, appellant,
    bond, `appeal_decided`, `final` to storage + views + `get_config`.
  - Direct suite: 30 → 40 tests (10 new: window, bond guards, late probe, refresh,
    forfeit/return, guards). Integration: +1 bonded-appeal lifecycle test.
  - Evidence: `genvm-lint --json` ok (3 passed, **21 methods**); `pytest tests -q` →
    **40 passed**; `ruff` clean; `gltest … --network studionet` → **6 passed** (360s);
    `gltest … -m slow` → **1 passed** (157s).
  - Next: Phase 2 deploy tooling **or** Phase 3 frontend (ask first).

- **2026-10-19 — Doc deep-dive on the 3 hard questions (no code change).**
  - Re-read `/equivalence-principle`, `/features/web-access`, `/features/messages`,
    `/features/transaction-context`, `/features/value-transfers`,
    `/features/interacting-with-intelligent-contracts`, `/storage`, plus the SDK
    `llms.txt` and `api.txt`.
  - Locked the three decisions (see new §10): no native `ecrecover` (tx signer auth is
    the signature stand-in); real-route probing via `web.request`/`web.render` but no
    in-consensus latency; bonded appeal is a contract-design task.
  - Also recorded: keep the `1jb45…` star-import style (do NOT migrate to the v0.3.0
    `import genlayer as gl`), and the `gl.storage.copy_to_memory` rule for nondet blocks.
  - Next: user picks Phase 2 (deploy tooling) **or** Phase 4 (bonded appeal).

- **2026-10-19 — Foundation + Phase 1 complete.**
  - Analysed the GenLayer docs and the family siblings; chose name **Observa** and
    the hybrid probe + attestation model (asked the user; they picked
    *contract + tests first*, hybrid, and a unique themed name).
  - Wrote `contracts/observa.py` (pinned runner, 9 view + 9 write, deterministic
    settlement, `run_nondet_unsafe` + `_verify`/`_handle_leader_error`).
  - Wrote `tests/conftest.py` + `tests/test_observa.py` (30 direct tests) and
    `tests/integration/test_consensus.py` (5 fast + 1 slow).
  - Added `pyproject.toml`, `gltest.config.yaml`, `.gitignore`, `README.md`.
  - Evidence: `genvm-lint … --json` ok (3 passed); `pytest tests -q` → 30 passed /
    5 skipped / 1 deselected; `ruff check .` clean; `gltest … --network studionet`
    → 5 passed (real web-fetch consensus, 232s); `gltest … -m slow` → 1 passed
    (45s window, settle, conservation held, 129s).
  - Next: Phase 2 deploy tooling **or** Phase 4 bonded challenge (await user).

## 8. Verified (cumulative)
- `genvm-lint check contracts/observa.py --json` → ok (3 passed, **27 methods**:
  11 view + 16 write).
- `python -m pytest tests\test_observa.py -q` → **54 passed** (2026-10-21).
- `python -m pytest tests -q` → **58 passed, 6 skipped, 1 deselected** (2026-10-21,
  after adding `tests/test_invariants.py`).
- `python -m ruff check .` → clean (2026-10-21).
- `gltest tests/integration -v -s --network studionet` → **6 passed** incl. the real
  web-fetch consensus probe and the bonded-appeal lifecycle (2026-10-19, 360.30s;
  predates payout delivery). On 2026-10-21 the updated suite hit Studionet's
  30 req/min limit after the first test; targeted reruns passed the refund and
  bonded-appeal paths (63s, 102s; bonded appeal again 111.73s after P1).
- `gltest tests/integration -v -s -m slow --network studionet` → **1 passed**: a real
  45s window, probe, tentative settle, bond, re-derive, finalize, payout rows and
  conservation held (2026-10-21, 149.51s after P1; earlier 155.12s/157.27s).
- Frontend: `npm --prefix frontend run lint` clean; `npm --prefix frontend run build`
  green (7 routes; `/deal/[id]` partial-prerender); production server smoke
  `/`, `/market`, `/open`, `/deal/s1` → 200; Chrome screenshots at 1440px and 512px
  verified (2026-10-20). Rebuilt with the payout ledger/coverage-floor UI and P1
  appeal copy on 2026-10-21: `npm run lint` clean, `npm run build` green. Rebuilt
  again with the live `.env.local`: `npm run lint` clean, `npm run build` green.
  Rebuilt after trimming deal polling to 30s/60s/120s: `npm run lint` clean,
  `npm run build` green.
- Deploy tooling (2026-10-21): `node deploy/deployScript.ts --dry-run` ok; real
  deploy `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d`; `node deploy/demoScript.ts`
  created `s1`/`s2` and printed `MET`, refund, payout rows and invariants;
  `node deploy/verifyScript.ts` fresh-deployed `0xC14ab3…38af` and passed
  **26/26**, including delivered refund, provider and bond rows.
- Frontend contract tests (2026-10-21): `npm run test:sync` -> **55 passed**;
  `test:frontend` -> **18 passed**; `test:frontend:write` -> **22 passed**;
  `test:frontend:full` -> **42 passed** (new deal `s3`, full escrow/appeal path).
- Browser E2E (2026-10-21): `npm run test:frontend:e2e` -> **20 passed, 0 failed**
  (deal `s12`, FINALIZED after a bonded appeal), with the reduced polling budget.

## 9. Trust model / known risks (keep visible)
- Slot probes trust the committee's fetch at slot times; a slot nobody probes on
  time is unobserved, so coverage is best-effort. A thin sample is not authoritative
  even if every probed slot was UP; `min_coverage_bps` decides when probes win.
- The attestation path trusts the named monitor; there is no on-chain signature
  check (see open question above). The monitor may re-commit a corrected report
  during the appeal window, so it can still change the reading before finalize; the
  digest binding prevents using bytes other than the committed ones, not a
  misbehaving monitor. Multiple monitors/median remains future work.
- A health endpoint ≠ real user experience. Prefer probing the real service route;
  the bonded appeal (Phase 4) is the implemented mitigation for contested readings.

## 10. Docs findings — locked decisions (read before touching the 3 hard questions)
Verified against the GenLayer docs + SDK reference (2026-10-19). These settle the
three "known risks" without further research.

1. **Signature / "real" signed attestation.** The SDK exposes exactly one crypto
   primitive: `Keccak256()`/`KeccakHash` (also `hashlib`). There is **no `ecrecover` /
   secp256k1 verification**, and the whitepaper lists signatures only as a *planned*
   native type. So an on-chain ECDSA check is impossible today. The design is still
   sound because a write tx is authenticated by its EVM key: the monitor's
   `commit_attestation` is genuinely signed by the monitor, and the on-chain digest
   commitment *is* the signature binding. If an *arbitrary off-chain* signature must
   be verified, do it via `gl.nondet.web.request` → EVM `eth_call` to a verifier
   inside a nondet block with `strict_eq` (cross-chain RPC pattern in the skill).
2. **Health endpoint ≠ UX / latency.** Web access supports `gl.nondet.web.request(url,
   method=…, body=…)`, `gl.nondet.web.render(url, mode='html'|'screenshot')` and
   `response.status_code` — so probes can target the *real user route* (or render it),
   not just `/health`. Latency, however, cannot be measured in-consensus: the clock is
   the tx timestamp (no wall clock, no block number), and validators run at different
   times. Availability SLA = in-protocol; latency SLA = needs external attestation or
   a tolerance. Never add a wall-clock dependency.
3. **One-shot settlement / appeal.** The protocol itself has an appeal window
   (`on='decided'` vs `on='finalized'`; a write can re-execute across appeal rounds),
   and a contract-level bonded appeal is just extra methods + a bond — no platform
   blocker. Implement as `settle` → tentative verdict → bond → re-derive →
   `finalize`, mirroring `sacramentum`. Recommend two-phase `settle` when Phase 4 lands.
4. **Storage in nondet blocks.** Storage objects must not be accessed inside a nondet
   block; copy to memory first (`gl.storage.copy_to_memory`, or capture scalars with
   `str()`/`int()` before the block). Observa already does this — keep it that way.

5. **Prompt injection / untrusted web data (re-checked 2026-10-21).** Observa has no
   LLM prompt, so the prompt-injection class is out of scope by construction. The
   untrusted surfaces are the probe response and the attestation JSON. Probes read
   only the HTTP status and derive a boolean/`"UP"`/`"DOWN"`; no body text is stored
   or interpreted. Attestations must be a JSON object whose canonical bytes hash to
   the committed digest, and only `uptime_bps` (clamped to 0..10000) plus a clipped
   nonce are read. Terms are untrusted input but are validated into scalars before
   storage. **Residual boundary:** `endpoint` and `attestation_url` are arbitrary
   HTTPS URLs supplied by the parties, so validators can be made to fetch a
   host/port of the client's choosing (an SSRF-style reachability probe). Keep the
   `https://` requirement; a host allowlist is a product decision for a future
   phase, not a silent change to the terms format.
