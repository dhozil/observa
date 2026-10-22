# Observa — Steward Review: Requests, Resolutions, Evidence

This document answers every review request against the `Observa` intelligent
contract and records the proof for each fix. It is intended to be read alongside
`contracts/observa.py`, `tests/`, and the deployment table in `README.md`.

| Item | Value |
| --- | --- |
| Contract | `contracts/observa.py` (class `Observa`) |
| Runner pin | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Surface | 27 methods (11 view + 16 write), no ctor params |
| Source protocol default | `APPEAL_WINDOW_SEC = 3600` |
| Review/demo deployment | `0xfc00d1B20Fc07E43EdAAf390Bf8C46649741ed9c` (60s appeal window) |
| Deployment tx | `0xafec9b15b60b95e4fd1e67dffc7783329260707cee1784992d5f863c02695c7c` |
| Live demo deals | `s1` FINALIZED / MET, `s2` REFUNDED; guard artifacts `s3..s5` APPEALED |

## 0. Summary

| ID | Review request | Status | Primary evidence |
| --- | --- | --- | --- |
| S-1 | An appeal must not be resolvable before the appeal deadline, and an already-`final` verdict must not bypass the deadline either. | Resolved | `test_appeal_cannot_resolve_before_the_window_closes`, `test_finalize_waits_out_the_appeal_window` |
| S-2 | Evidence writes must close at the same deadline as the verdict, so filing an appeal cannot shorten the response window. | Resolved | `test_attestation_writes_close_at_the_appeal_deadline`, `_monitoring_open` |
| S-3 | A finalized transaction with a leader execution error must not be reported as success in the frontend. | Resolved | `frontendSync.ts` section 10 (3 checks), exported `leaderFailure` |
| S-4 | A recovered payout attempt must not be able to book a second time if the old child transfer lands late. | Resolved | `test_a_recovered_attempt_cannot_book_after_the_retry` |
| S-5 | A monitor report must be bound to the agreement, not just to its bytes, so a valid report for another deal cannot be replayed. | Resolved | `test_submit_attestation_rejects_a_report_for_another_deal`, `..._outside_the_agreement_window`, `..._service_and_terms_mismatches` |
| S-6 | A thin probe sample must not decide an SLA; the coverage floor is authoritative. | Resolved | `test_settle_accepts_exactly_the_committed_coverage_floor`, `test_settle_rejects_one_bps_below_the_floor`, `_probe_coverage_authoritative` |
| S-7 | Document the signature/trust boundary for monitor attestations. | Documented | `_attestation_once` docstring, README trust model, `information_needed.md` §8 |
| F-1 | Frontend empty-state shipped before the id list resolved (found during frontend audit). | Resolved | `useRead` `enabled` gate, `useDeals(null)` stays loading, `page.tsx` / `market/page.tsx` pass `ids.data === null ? null : ids` |

## 1. Verification snapshot

Run from the repository root on 2026-10-23.

```text
genvm-lint check contracts/observa.py --json
  -> ok: {"ok":true,"lint":{"ok":true,"passed":3},
          "validate":{"contract":"Observa","methods":27,
                      "view_methods":11,"write_methods":16,"ctor_params":0}}

python -m pytest tests/test_observa.py -q
  -> 60 passed

python -m pytest tests -q
  -> 64 passed, 6 skipped, 1 deselected

python -m ruff check .
  -> All checks passed!

npm run test:sync
  -> 63 passed, 0 failed

npm run test:frontend            -> 18 passed   (live reads)
npm run test:frontend:write      -> 22 passed   (revert guards / tx phases)
npm run test:frontend:full       -> 40 passed   (full escrow path, stops at APPEALED)
npm run test:frontend:e2e        -> 21 passed   (real Chrome + injected EIP-6963 wallets)

npm --prefix frontend run lint   -> clean
npm --prefix frontend run build  -> green (7 routes; /deal/[id] partial-prerender)
```

The frontend live/E2E suites above were run against
`0xfc00d1B20Fc07E43EdAAf390Bf8C46649741ed9c`. The backend suites
(`pytest`, `ruff`, `genvm-lint`) are network-free. The empty-state fix (F-1) was
applied after those live runs and was validated with frontend `lint` + `build`;
it does not touch the contract or the live/RPC layer.

## 2. S-1 — Early appeal resolution / deadline bypass

**Request.** A party must not be able to file an appeal and immediately resolve it,
locking a verdict before the remaining evidence window closes. `finalize` must also
honour the deadline even when the verdict is already marked final.

**Why it mattered.** `appeal` opens a response window in which the counterparty and
the monitor may add late probes and re-commit a corrected report. If
`resolve_appeal` could run immediately, the appellant could freeze the first
verdict and deny the other side that window.

**Fix.** Both `resolve_appeal` and `finalize` reject before the deadline, and the
`finalize` check is unconditional (not gated on `final`):

`contracts/observa.py:1035`
```python
if _now_unix() <= int(deal.appeal_deadline_unix):
    raise gl.vm.UserError(f"{ERROR_EXPECTED} the appeal window for {deal_id} is still open")
```

`contracts/observa.py:1082`
```python
if _now_unix() <= int(deal.appeal_deadline_unix):
    raise gl.vm.UserError(f"{ERROR_EXPECTED} the appeal window for {deal_id} is still open")
if not bool(deal.final):
    ...
```

**Regression tests.**
- `tests/test_observa.py:682` `test_appeal_cannot_resolve_before_the_window_closes`
  - Files an appeal, asserts `resolve_appeal` reverts with `still open`, asserts
    `finalize` reverts with `no standing verdict`, asserts status is still
    `APPEALED` and `held == ESCROW + APPEAL_BOND`, then warps past the deadline and
    completes resolve + finalize.
- `tests/test_observa.py:609` `test_finalize_waits_out_the_appeal_window`.
- `tests/integration/test_consensus.py` bonded-appeal lifecycle stages a copy with
  `APPEAL_WINDOW_SEC = 30` and proves an immediate `resolve_appeal` is rejected
  before the same call succeeds after the deadline (this path passed on Studionet
  in 148.34s; see AGENTS.md activity log).

## 3. S-2 — Evidence writes close at the verdict deadline

**Request.** If an appeal is filed, the deadline for new evidence must not move;
otherwise an appeal would actually shorten the other party's response window.

**Fix.** One shared helper decides admissibility for probes and attestations. It is
true during `ACTIVE` and during an unexpired `APPEALED` / non-final `RESOLVED`
window, and false once the deadline passes:

`contracts/observa.py:1249`
```python
def _monitoring_open(self, deal: Deal) -> bool:
    status = str(deal.status)
    if status == STATUS_ACTIVE:
        return True
    if status == STATUS_APPEALED:
        return _now_unix() <= int(deal.appeal_deadline_unix)
    if status == STATUS_RESOLVED and not bool(deal.final):
        return _now_unix() <= int(deal.appeal_deadline_unix)
    return False
```

`commit_attestation` (`contracts/observa.py:813`) and `submit_attestation`
(`contracts/observa.py:848`) both require `_monitoring_open`, so a late commit or
submit reverts with `is not active`.

**Regression test.**
- `tests/test_observa.py:707` `test_attestation_writes_close_at_the_appeal_deadline`
  - Records a valid attestation, settles, files an appeal, warps past the deadline,
    and asserts both a corrected `commit_attestation` and a `submit_attestation`
    revert with `is not active`.

## 4. S-3 — Frontend must reject a finalized tx whose execution failed

**Request.** `FINALIZED` is a consensus/ordering status, not proof that the leader
executed the call successfully. The UI must inspect the leader receipt instead of
treating any final receipt as success.

**Fix.** The frontend exports a pure `leaderFailure(receipt)` and uses it before
reporting success:

`frontend/src/lib/observa.ts:474`
```ts
export function leaderFailure(receipt: ProtocolReceipt): string | null {
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
```

`frontend/src/lib/observa.ts:595` calls `leaderFailure(receipt)` and returns
`{ ok: false, message }` when it is non-null.

**Regression tests.** `tests/frontendSync.ts` section 10:
- `a successful execution is accepted` (`execution_result: "SUCCESS"`, `status: "return"`).
- `an execution error is rejected even when the tx finalized` (`execution_result: "ERROR"`, `error_code: "CONTRACT_ERROR"`, payload `[EXPECTED] rejected`).
- `a non-return result status is rejected` (`execution_result: "SUCCESS"`, `status: "error"`).

These are part of the `npm run test:sync` run that reports **63 passed, 0 failed**.

## 5. S-4 — Payout recovery must not double-book

**Request.** A payout row that has been recovered after the grace period must be
dead. If the first child transfer lands late, it must not be confirmed and must not
move `total_released` / `lifetime_outflow`. Only a fresh retry may create a new
bookable attempt.

**Fix.** The payout state machine is `owed -> sent -> delivered`, with one global
in-flight transfer. `recover_payout` moves a `sent` row back to `owed` after
`PAYOUT_GRACE_SEC`; a recovered attempt no longer exists, so `confirm_payout`
reverts:

`contracts/observa.py:1189` (`recover_payout`)
```python
if str(payout.state) != PAYOUT_SENT:
    raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} has no attempt to recover")
...
self._return_payout(payout, 0, "recovered")
```

`contracts/observa.py:1209` (`confirm_payout`)
```python
if str(payout.state) != PAYOUT_SENT:
    raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} has no attempt to confirm")
```

**Regression test.** `tests/test_observa.py:1159`
`test_a_recovered_attempt_cannot_book_after_the_retry`:
- Settles + finalizes, so the provider row is `sent`.
- Warps past the payout grace and recovers the attempt.
- Simulates the late child transfer leaving the host balance (`direct_vm.deal(..., 0)`).
- Asserts `confirm_payout` reverts with `has no attempt to confirm`,
  `total_released_atto == "0"`, and `unreconciled_payouts == 0`.
- Restores the escrow balance, retries as the beneficiary, confirms once, and
  asserts `total_released_atto == ESCROW`, `lifetime_outflow_atto == ESCROW`,
  `pending_payouts == 0`, `unreconciled_payouts == 0`, `conserved is True`,
  `deal["paid_atto"] == ESCROW`, and a second retry reverts.

The randomized invariant suite (`tests/test_invariants.py`) additionally asserts
`held == inflow - outflow == owed + in_flight`, `conserved`, zero pending, and
delivered rows summing to escrow (+ bond) after every lifecycle.

## 6. S-5 — Bind the monitor report to the agreement

**Request.** Matching the committed digest only proves that the fetched bytes are
the bytes the monitor committed. It does not prove the bytes describe *this* deal.
A valid report for another agreement, or another window, must not be accepted.

**Fix.** `_attestation_once` now requires the report to carry and match five fields
before the reading is accepted:

`contracts/observa.py:337` (`_attestation_once`)
```python
if str(parsed.get("deal_id", "")) != expected["deal_id"]:
    raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation is for a different deal")
if str(parsed.get("service", "")) != expected["service"]:
    raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation service does not match the agreement")
if str(parsed.get("terms_digest", "")).strip().lower() != expected["terms_digest"]:
    raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation terms digest does not match the agreement")
window_start = _require_int(parsed.get("window_start_unix"), "window_start_unix")
window_end = _require_int(parsed.get("window_end_unix"), "window_end_unix")
if window_start != expected["window_start_unix"] or window_end != expected["window_end_unix"]:
    raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation window does not match the agreement")
```

`_derive_attestation` builds `expected` from the stored deal
(`contracts/observa.py:858`):
```python
expected = {
    "deal_id": str(deal.id),
    "service": str(deal.service),
    "terms_digest": str(deal.terms_digest).strip().lower(),
    "window_start_unix": int(deal.started_at_unix),
    "window_end_unix": int(deal.end_unix),
}
```

Error text is static (`ERROR_EXTERNAL` + fixed strings), so a leader and a validator
that hit the same failure produce identical messages.

**Regression tests.**
- `tests/test_observa.py:329` `test_submit_attestation_rejects_a_report_for_another_deal`
  - Commits deal A's report against deal B, submits B, expects `different deal`.
- `tests/test_observa.py:347` `test_submit_attestation_rejects_a_report_outside_the_agreement_window`
  - Shifts `window_end_unix` by 1, expects `window does not match`.
- `tests/test_observa.py:363` `test_submit_attestation_rejects_service_and_terms_mismatches`
  - A wrong `service` expects `service does not match`; a wrong `terms_digest`
    expects `terms digest does not match`.
- `tests/conftest.py` `attestation_for(contract, deal_id, uptime_bps, nonce)` builds
  every direct-test report from `get_deal`, so the happy path is bound by
  construction and cannot accidentally pass with a replayable report.

The browser-side canonical digest is also checked against Python's
`json.dumps(sort_keys=True, separators=(",", ":"))` in `tests/frontendSync.ts`
section 9 (`SHA-256 matches Python ...`), using a report that carries all five
binding fields.

## 7. S-6 — Coverage floor is authoritative

**Request.** A single probe must not decide a whole multi-slot SLA. Probes are only
authoritative when a meaningful fraction of slots were actually observed.

**Fix.** `_probe_coverage_authoritative` requires at least one probe and coverage at
or above the committed floor:

`contracts/observa.py:888`
```python
def _probe_coverage_authoritative(self, deal: Deal) -> bool:
    return int(deal.probed_slots) > 0 and self._coverage_bps(deal) >= int(deal.min_coverage_bps)
```

When coverage is thin and there is no attestation, `settle` refuses and
`claim_lapsed` later refunds the client as `inconclusive_coverage` — a thin sample
is never allowed to decide the SLA.

**Regression tests.**
- `tests/test_observa.py` `test_settle_accepts_exactly_the_committed_coverage_floor`
  and `test_settle_rejects_one_bps_below_the_floor` (exact floor and floor - 1 bps).
- `test_settle_honours_a_zero_floor_with_a_single_probe` (a zero floor still needs
  one probe).
- `test_settle_refuses_thin_coverage_then_lapse_refunds`,
  `test_claim_lapsed_refuses_when_coverage_is_authoritative`.

## 8. S-7 — Signature / trust boundary (documented)

The GenVM SDK exposes `Keccak256` but no `ecrecover` / secp256k1 verification, so an
on-chain ECDSA check is not possible today. Observa therefore treats the monitor's
`commit_attestation` transaction as the binding: it is authenticated by the
monitor's EVM key, and the on-chain digest commitment is the signature stand-in.
The digest binds the bytes; the five fields in §6 bind the bytes to the agreement.
This is stated in the contract docstrings and in the README trust model. It does
not stop a misbehaving monitor — multiple monitors / median attestation remain
future work, with the appeal bond as the current mitigation.

Related residual boundaries:
- `endpoint` and `attestation_url` are arbitrary HTTPS URLs supplied by the
  parties, so validators can be induced to fetch a chosen host/port (SSRF-style
  reachability). The `https://` requirement is kept; a host allowlist is a product
  decision, not a silent terms-format change.
- Latency is not measurable in consensus (the clock is the tx timestamp), so
  Observa enforces an availability SLA, not a latency SLA.
- The live integration suite has no attestation URL fixture; report binding is
  covered by the direct-mode tests above, while the live suite covers the
  probe/refund/appeal paths.

## 9. F-1 — Empty-state flash (frontend audit)

`useDeals(null)` used to resolve `[]` before `get_deal_ids` returned, so `/` and
`/market` briefly showed "The record is empty." The fix distinguishes *ids not
loaded yet* from *a loaded empty list*:

- `useRead` accepts an `enabled` gate and does not run when it is false.
- `useDeals(ids)` is `enabled: ids !== null`; `null` stays loading, `[]` resolves.
- `/` and `/market` pass `ids.data === null ? null : ids` and surface `ids.error`.

Validated with frontend `lint` clean and `next build` green.

## 10. Deployment and end-to-end proof

| Contract | Purpose | Address | Deploy tx |
| --- | --- | --- | --- |
| Test/demo (60s appeal, deadline guard + report binding) | Current review instance | `0xfc00d1B20Fc07E43EdAAf390Bf8C46649741ed9c` | `0xafec9b15b60b95e4fd1e67dffc7783329260707cee1784992d5f863c02695c7c` |
| Superseded test/demo (60s, deadline guard only) | Historical | `0xad5dfb1b972C9717cFc7B7460961d051203185E1` | `0xdf3aa6c15cb885a4851680f26dc88b9de7e0c0e1a798666d34b67dc0fe5ed102` |
| First production-style (1h, pre-hardening) | Historical | `0xAD6aCc4Be89dF0C9e246eeF6274D77EA589De17d` | `0xd873cfa9f034ea0994f62ef4f8f56e6831f6a0225f194658bf210f6edc05c3f7` |

`npm run deploy -- --appeal-window 60` deployed the current instance and read back
`appeal_window_sec=60`, `deals=0`, `held_atto=0`, `conserved=true`. The demo then
created `s1` (probe → settle → bond → resolve → finalize, FINALIZED/MET) and `s2`
(cancel/refund, REFUNDED). Guard runs left `s3..s5` at `APPEALED`; the frontend
`--full` and browser E2E runs above stop at that guard and assert Resolve/Finalize
are not offered early.

## 11. How to reproduce

```powershell
# contract gates
genvm-lint check contracts/observa.py --json
python -m pytest tests -q
python -m ruff check .

# frontend surface + live guards
npm run test:sync
npm run test:frontend
npm run test:frontend:write
npm run test:frontend:full

# browser E2E (rebuild first: NEXT_PUBLIC_* is baked into the production build)
npm --prefix frontend run build
npm run test:frontend:e2e
```

After changing `frontend/.env.local`, always rebuild before E2E or a smoke run: a
stale build silently points the browser at the previous contract.
