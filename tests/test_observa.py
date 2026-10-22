"""Direct-mode tests for the Observa SLA escrow contract.

These run the contract in-process with mocked web calls. They cover validation,
the monitoring lifecycle, money conservation, and the leader/validator logic.
The validator comparison is exercised through direct_vm.run_validator().
"""

import json

from conftest import (
    APPEAL_BOND,
    APPEAL_WINDOW_SEC,
    CONTRACT,
    ENDPOINT,
    ESCROW,
    GEN,
    SLOTS,
    WINDOW_SECONDS,
    active_deal,
    at,
    attestation_report,
    confirm_all_payouts,
    file_appeal,
    hx,
    mock_attestation,
    mock_probe,
    open_deal,
    report_digest,
    run_probes,
    settle_and_finalize,
    sla_terms,
)


def stats(contract):
    return json.loads(contract.get_stats())


def deal(contract, deal_id):
    return json.loads(contract.get_deal(deal_id))


def audit(contract, deal_id):
    return json.loads(contract.get_deal_audit(deal_id))


def payouts(contract, deal_id):
    return json.loads(contract.get_payouts(deal_id))["payouts"]


# ---------------------------------------------------------------- deal open


def test_open_deal_records_terms_and_parties(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    deal_id = contract.open_deal(hx(direct_bob), sla_terms())

    view = deal(contract, deal_id)
    assert view["status"] == "OPEN"
    assert view["client"].lower() == hx(direct_alice).lower()
    assert view["provider"].lower() == hx(direct_bob).lower()
    assert view["endpoint"] == ENDPOINT
    assert view["slots"] == SLOTS
    assert view["slot_seconds"] == WINDOW_SECONDS // SLOTS
    assert len(view["terms_digest"]) == 64
    assert contract.get_terms(deal_id) == json.dumps(json.loads(sla_terms()), sort_keys=True, separators=(",", ":"))
    assert json.loads(contract.get_deal_ids()) == [deal_id]
    assert contract.get_deal_count() == 1


def test_open_deal_accepts_string_integers(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    terms = json.dumps({
        "service": "Acme",
        "endpoint": ENDPOINT,
        "window_seconds": "3600",
        "slots": "4",
        "uptime_target_bps": "9900",
    })
    deal_id = contract.open_deal(hx(direct_bob), terms)
    view = deal(contract, deal_id)
    assert view["window_seconds"] == 3600
    assert view["slots"] == 4
    assert view["uptime_target_bps"] == 9900


def test_open_deal_rejects_invalid_terms(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be a JSON object"):
        contract.open_deal(hx(direct_bob), "[1,2,3]")
    with direct_vm.expect_revert("must name a service"):
        contract.open_deal(hx(direct_bob), json.dumps({"endpoint": ENDPOINT, "window_seconds": 3600, "slots": 4, "uptime_target_bps": 9900}))
    with direct_vm.expect_revert("endpoint must start with https://"):
        contract.open_deal(hx(direct_bob), sla_terms(endpoint="http://insecure.example.org"))
    with direct_vm.expect_revert("window_seconds must be positive"):
        contract.open_deal(hx(direct_bob), sla_terms(window_seconds=0))
    with direct_vm.expect_revert("slots must be between"):
        contract.open_deal(hx(direct_bob), sla_terms(slots=0))
    with direct_vm.expect_revert("window_seconds must be at least slots"):
        contract.open_deal(hx(direct_bob), sla_terms(window_seconds=10, slots=20))
    with direct_vm.expect_revert("uptime_target_bps must be between"):
        contract.open_deal(hx(direct_bob), sla_terms(uptime_target_bps=0))


def test_open_deal_rejects_float_target_and_bad_monitor(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be a whole number"):
        contract.open_deal(hx(direct_bob), sla_terms(uptime_target_bps=9900.5))
    monitor_without_url = json.dumps({
        "service": "Acme",
        "endpoint": ENDPOINT,
        "window_seconds": 3600,
        "slots": 4,
        "uptime_target_bps": 9900,
        "monitor": hx(direct_charlie),
    })
    with direct_vm.expect_revert("a monitor requires an https attestation_url"):
        contract.open_deal(hx(direct_bob), monitor_without_url)
    with direct_vm.expect_revert("client and provider must differ"):
        contract.open_deal(hx(direct_alice), sla_terms())


# ---------------------------------------------------------------- funding


def test_fund_requires_client_and_value(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    deal_id = contract.open_deal(hx(direct_bob), sla_terms())

    with direct_vm.expect_revert("must be called with GEN value"):
        contract.fund_deal(deal_id)

    direct_vm.sender = direct_bob
    direct_vm.value = GEN
    with direct_vm.expect_revert("only the client may fund"):
        contract.fund_deal(deal_id)
    direct_vm.value = 0

    direct_vm.sender = direct_alice
    direct_vm.value = ESCROW
    contract.fund_deal(deal_id)
    direct_vm.value = 0
    assert deal(contract, deal_id)["status"] == "FUNDED"
    assert deal(contract, deal_id)["escrow_atto"] == str(ESCROW)

    direct_vm.value = GEN
    with direct_vm.expect_revert("is not open"):
        contract.fund_deal(deal_id)
    direct_vm.value = 0


def test_start_requires_provider(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    deal_id = open_deal(direct_vm, contract, hx(direct_bob))

    with direct_vm.expect_revert("only the provider may start"):
        contract.start_deal(deal_id)

    direct_vm.sender = direct_bob
    contract.start_deal(deal_id)
    view = deal(contract, deal_id)
    assert view["status"] == "ACTIVE"
    assert view["end_unix"] == view["started_at_unix"] + WINDOW_SECONDS


def test_cancel_before_start_refunds_and_after_start_is_blocked(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    deal_id = open_deal(direct_vm, contract, hx(direct_bob))
    contract.cancel_deal(deal_id)
    assert deal(contract, deal_id)["status"] == "REFUNDED"
    confirm_all_payouts(direct_vm, contract, deal_id)
    assert stats(contract)["conserved"] is True

    deal_id2 = active_deal(direct_vm, contract, direct_alice, direct_bob)
    with direct_vm.expect_revert("cannot be cancelled from ACTIVE"):
        direct_vm.sender = direct_alice
        contract.cancel_deal(deal_id2)


# ---------------------------------------------------------------- probing


def test_probe_records_up_and_down(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)

    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    direct_vm.warp(at(900))
    direct_vm.clear_mocks()
    mock_probe(direct_vm, status=503)
    contract.probe_slot(deal_id, 1)

    view = deal(contract, deal_id)
    assert view["probed_slots"] == 2
    assert view["up_slots"] == 1
    log = json.loads(contract.get_monitor_log(deal_id))
    assert log[0] == {"s": "UP", "http": 200}
    assert log[1] == {"s": "DOWN", "http": 503}
    assert log[2] is None


def test_probe_window_bounds(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)

    with direct_vm.expect_revert("is not open yet"):
        contract.probe_slot(deal_id, 1)
    with direct_vm.expect_revert("slot must be between"):
        contract.probe_slot(deal_id, 99)

    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    with direct_vm.expect_revert("has already been probed"):
        contract.probe_slot(deal_id, 0)

    # Slot 1 opened at +900 and closed at +2100; it was never probed.
    direct_vm.warp(at(2200))
    with direct_vm.expect_revert("has closed"):
        contract.probe_slot(deal_id, 1)


def test_probe_requires_active(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_alice
    deal_id = open_deal(direct_vm, contract, hx(direct_bob))
    with direct_vm.expect_revert("is not active"):
        contract.probe_slot(deal_id, 0)


def test_expect_status_pins_a_specific_code(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(expect_status=204))
    mock_probe(direct_vm, status=204)
    contract.probe_slot(deal_id, 0)
    direct_vm.warp(at(900))
    direct_vm.clear_mocks()
    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 1)
    view = deal(contract, deal_id)
    assert view["up_slots"] == 1  # 204 was UP, 200 was DOWN under expect_status=204


# ---------------------------------------------------------------- validation


def test_probe_validator_agrees_on_the_same_status(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    assert direct_vm.run_validator() is True


def test_probe_validator_rejects_a_flipped_status(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    direct_vm.clear_mocks()
    mock_probe(direct_vm, status=503)
    assert direct_vm.run_validator() is False


# ---------------------------------------------------------------- attestation


def test_commit_attestation_guards(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the deal monitor may commit"):
        contract.commit_attestation(deal_id, "a" * 64, "n1")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("must be a 64-character hex sha256"):
        contract.commit_attestation(deal_id, "short", "n1")

    contract.commit_attestation(deal_id, "A" * 64, "n1")
    assert audit(contract, deal_id)["attested_digest"] == "a" * 64


def test_commit_attestation_needs_a_monitor(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("has no monitor"):
        contract.commit_attestation(deal_id, "a" * 64, "n1")


def test_submit_attestation_records_the_uptime(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    report = attestation_report(9600, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")

    with direct_vm.expect_revert("no attestation has been committed"):
        direct_vm.sender = direct_charlie
        other_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
        contract.submit_attestation(other_id)

    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)
    assert audit(contract, deal_id)["attested"] is True
    assert audit(contract, deal_id)["attested_bps"] == 9600


def test_submit_attestation_rejects_a_digest_mismatch(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    committed = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(committed), "n1")

    mock_attestation(direct_vm, attestation_report(10000, "tampered"))
    with direct_vm.expect_revert("does not match the committed digest"):
        contract.submit_attestation(deal_id)


def test_attestation_validator_agrees_and_rejects(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    report = attestation_report(9700, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)
    assert direct_vm.run_validator() is True

    direct_vm.clear_mocks()
    mock_attestation(direct_vm, report, status=500)
    assert direct_vm.run_validator() is False


def test_attestation_validator_agrees_on_a_transient_failure(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    report = attestation_report(9700, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)

    direct_vm.clear_mocks()
    mock_attestation(direct_vm, report, status=503)
    verdict = direct_vm.run_validator(leader_error=Exception("[TRANSIENT] attestation source unavailable"))
    assert verdict is True


# ---------------------------------------------------------------- settle


def test_settle_requires_a_closed_window(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    with direct_vm.expect_revert("still open"):
        contract.settle(deal_id)


def test_settle_without_evidence_reverts(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.warp(at(WINDOW_SECONDS))
    with direct_vm.expect_revert("no monitoring evidence"):
        contract.settle(deal_id)


def test_settle_accepts_exactly_the_committed_coverage_floor(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm,
        contract,
        direct_alice,
        direct_bob,
        terms=sla_terms(min_coverage_bps=5000),
    )
    run_probes(direct_vm, contract, deal_id, [200, 200])  # exactly 2/4
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    assert deal(contract, deal_id)["outcome"] == "MET"


def test_settle_rejects_one_bps_below_the_floor(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm,
        contract,
        direct_alice,
        direct_bob,
        terms=sla_terms(min_coverage_bps=5001),
    )
    run_probes(direct_vm, contract, deal_id, [200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    with direct_vm.expect_revert("coverage is below the committed floor"):
        contract.settle(deal_id)


def test_settle_honours_a_zero_floor_with_a_single_probe(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm,
        contract,
        direct_alice,
        direct_bob,
        terms=sla_terms(min_coverage_bps=0),
    )
    run_probes(direct_vm, contract, deal_id, [503])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    view = deal(contract, deal_id)
    assert view["outcome"] == "BREACHED"
    assert view["uptime_bps"] == 0


def test_settle_full_uptime_meets_the_target(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    settle_and_finalize(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["status"] == "FINALIZED"
    assert view["outcome"] == "MET"
    assert view["uptime_bps"] == 10000
    assert view["release_bps"] == 10000
    assert view["escrow_atto"] == str(ESCROW)
    report = stats(contract)
    assert report["held_atto"] == "0"
    assert report["total_released_atto"] == str(ESCROW)
    assert report["conserved"] is True


def test_settle_below_target_splits_the_escrow(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 503, 200, 503])  # 2/4 = 5000 bps
    settle_and_finalize(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["outcome"] == "BREACHED"
    assert view["uptime_bps"] == 5000
    # release_bps = 10000 * 5000 // 9900 = 5050
    assert view["release_bps"] == 5050
    provider_cut = ESCROW * 5050 // 10000
    report = stats(contract)
    assert report["total_released_atto"] == str(provider_cut)
    assert report["total_refunded_atto"] == str(ESCROW - provider_cut)
    assert report["conserved"] is True


def test_settle_zero_uptime_refunds_the_client(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [503, 503, 503, 500])
    settle_and_finalize(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["outcome"] == "BREACHED"
    assert view["release_bps"] == 0
    report = stats(contract)
    assert report["total_released_atto"] == "0"
    assert report["total_refunded_atto"] == str(ESCROW)
    assert report["conserved"] is True


def test_settle_uses_attestation_when_coverage_is_thin(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    report = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)

    # One DOWN probe out of four slots is 2500 bps of coverage, under the 5000 floor.
    run_probes(direct_vm, contract, deal_id, [503])
    settle_and_finalize(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["probed_slots"] == 1
    assert view["uptime_bps"] == 10000  # the attested reading wins
    assert view["outcome"] == "MET"


def test_settle_prefers_probes_when_coverage_is_sufficient(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))
    report = attestation_report(2000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)

    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    settle_and_finalize(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["uptime_bps"] == 10000  # full coverage: probes beat the attestation
    assert view["outcome"] == "MET"


def test_settle_is_not_repeatable(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    with direct_vm.expect_revert("is not active"):
        contract.settle(deal_id)


# ------------------------------------------------------------------ appeal


def test_settle_opens_an_appeal_window_without_paying(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    view = deal(contract, deal_id)
    assert view["status"] == "RESOLVED"
    assert view["final"] is False
    assert view["outcome"] == "MET"
    assert view["release_bps"] == 10000
    assert view["first_release_bps"] == 10000
    assert view["appeal_deadline_unix"] == view["resolved_at_unix"] + APPEAL_WINDOW_SEC
    report = stats(contract)
    assert report["held_atto"] == str(ESCROW)  # nothing moves until finalize
    assert report["total_released_atto"] == "0"
    assert report["conserved"] is True


def test_finalize_waits_out_the_appeal_window(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    with direct_vm.expect_revert("still open"):
        contract.finalize(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)
    view = deal(contract, deal_id)
    assert view["status"] == "FINALIZED"
    report = stats(contract)
    assert report["held_atto"] == "0"
    assert report["total_released_atto"] == str(ESCROW)
    assert report["conserved"] is True


def test_appeal_requires_a_party_and_a_bond(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    direct_vm.sender = direct_bob
    direct_vm.value = APPEAL_BOND - 1
    with direct_vm.expect_revert("appeal bond must be at least"):
        contract.appeal(deal_id)
    direct_vm.value = 0

    direct_vm.sender = direct_charlie
    direct_vm.value = APPEAL_BOND
    with direct_vm.expect_revert("only a party to the deal may appeal"):
        contract.appeal(deal_id)
    direct_vm.value = 0


def test_appeal_window_closes(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    direct_vm.sender = direct_alice
    direct_vm.value = APPEAL_BOND
    with direct_vm.expect_revert("appeal window for"):
        contract.appeal(deal_id)
    direct_vm.value = 0


def test_resolve_appeal_requires_a_pending_appeal(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    with direct_vm.expect_revert("no pending appeal"):
        contract.resolve_appeal(deal_id)


def test_finalize_without_a_verdict_reverts(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    with direct_vm.expect_revert("no standing verdict"):
        contract.finalize(deal_id)


def test_losing_appeal_forfeits_the_bond(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    """The client appeals an already-full release; nothing changes, so it loses the bond."""
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    file_appeal(direct_vm, contract, direct_alice, deal_id)
    assert deal(contract, deal_id)["status"] == "APPEALED"
    assert stats(contract)["held_atto"] == str(ESCROW + APPEAL_BOND)

    contract.resolve_appeal(deal_id)
    assert deal(contract, deal_id)["final"] is True

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)
    report = stats(contract)
    assert report["held_atto"] == "0"
    # The provider kept the escrow and took the forfeited bond.
    assert report["total_released_atto"] == str(ESCROW)
    assert report["total_refunded_atto"] == "0"
    assert report["lifetime_outflow_atto"] == str(ESCROW + APPEAL_BOND)
    assert report["conserved"] is True


def test_late_probe_then_appeal_moves_the_verdict_and_returns_the_bond(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm,
        contract,
        direct_alice,
        direct_bob,
        terms=sla_terms(min_coverage_bps=2500),
    )

    # Only slot 0 is probed (UP). Slots 1-3 are left unobserved, but 1/4 meets
    # the deliberately low floor committed in the terms.
    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    assert deal(contract, deal_id)["release_bps"] == 10000  # 1/1 so far

    # Slot 3 is still open (it closes at +3900); the client files a late DOWN
    # probe, then appeals to force the re-derivation.
    direct_vm.warp(at(WINDOW_SECONDS + 5))
    direct_vm.clear_mocks()
    mock_probe(direct_vm, status=503)
    contract.probe_slot(deal_id, 3)
    file_appeal(direct_vm, contract, direct_alice, deal_id)
    contract.resolve_appeal(deal_id)

    view = deal(contract, deal_id)
    assert view["probed_slots"] == 2
    assert view["uptime_bps"] == 5000
    assert view["release_bps"] == 5050
    assert view["final"] is True

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)
    provider_cut = ESCROW * 5050 // 10000
    report = stats(contract)
    assert report["total_released_atto"] == str(provider_cut)
    assert report["total_refunded_atto"] == str(ESCROW - provider_cut)
    # The client won the appeal, so its bond came back on top of the split.
    assert report["lifetime_outflow_atto"] == str(ESCROW + APPEAL_BOND)
    assert report["conserved"] is True


def test_finalize_folds_in_a_late_probe_without_an_appeal(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm,
        contract,
        direct_alice,
        direct_bob,
        terms=sla_terms(min_coverage_bps=2500),
    )

    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS + 5))
    direct_vm.clear_mocks()
    mock_probe(direct_vm, status=503)
    contract.probe_slot(deal_id, 3)

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)
    view = deal(contract, deal_id)
    assert view["release_bps"] == 5050
    provider_cut = ESCROW * 5050 // 10000
    report = stats(contract)
    assert report["total_released_atto"] == str(provider_cut)
    assert report["total_refunded_atto"] == str(ESCROW - provider_cut)
    assert report["conserved"] is True


def test_resolve_appeal_refreshes_a_recommitted_attestation(warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie))

    good = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(good), "n1")
    mock_attestation(direct_vm, good)
    contract.submit_attestation(deal_id)

    # No probes, so the attested reading is authoritative.
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    assert deal(contract, deal_id)["release_bps"] == 10000

    # During the appeal the monitor publishes a corrected report and re-commits.
    direct_vm.sender = direct_charlie
    corrected = attestation_report(5000, "n2")
    contract.commit_attestation(deal_id, report_digest(corrected), "n2")
    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected)

    file_appeal(direct_vm, contract, direct_alice, deal_id)
    contract.resolve_appeal(deal_id)

    view = deal(contract, deal_id)
    assert view["uptime_bps"] == 5000
    assert view["release_bps"] == 5050
    assert audit(contract, deal_id)["attested_bps"] == 5000


def test_recommit_clears_the_old_reading_until_resubmitted(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """The recorded bps is bound to the committed digest, not just the monitor."""
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    good = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(good), "n1")
    mock_attestation(direct_vm, good)
    contract.submit_attestation(deal_id)
    assert audit(contract, deal_id)["attested"] is True

    corrected = attestation_report(5000, "n2")
    contract.commit_attestation(deal_id, report_digest(corrected), "n2")
    view = audit(contract, deal_id)
    assert view["attested"] is False
    assert view["attested_bps"] == 0
    assert view["attested_digest"] == report_digest(corrected)

    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected)
    contract.submit_attestation(deal_id)
    assert audit(contract, deal_id)["attested_bps"] == 5000


def test_resolve_appeal_keeps_the_verdict_and_returns_the_bond_when_the_source_is_down(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    report = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "n1")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    assert deal(contract, deal_id)["release_bps"] == 10000
    file_appeal(direct_vm, contract, direct_alice, deal_id)
    assert stats(contract)["held_atto"] == str(ESCROW + APPEAL_BOND)

    direct_vm.sender = direct_charlie
    corrected = attestation_report(5000, "n2")
    contract.commit_attestation(deal_id, report_digest(corrected), "n2")
    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected)
    contract.submit_attestation(deal_id)  # admissible during the appeal
    assert audit(contract, deal_id)["attested_bps"] == 5000

    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected, status=503)
    contract.resolve_appeal(deal_id)

    view = deal(contract, deal_id)
    assert view["final"] is True
    assert view["release_bps"] == 10000
    assert view["appeal_evidence_unavailable"] is True

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)

    report_stats = stats(contract)
    assert report_stats["held_atto"] == "0"
    assert report_stats["total_released_atto"] == str(ESCROW)
    assert report_stats["conserved"] is True
    rows = {row["kind"]: row for row in json.loads(contract.get_payouts(deal_id))["payouts"]}
    assert rows["bond"]["recipient"].lower() == hx(direct_alice).lower()
    assert rows["bond"]["amount_atto"] == str(APPEAL_BOND)


def test_finalize_uses_a_corrected_attestation_without_an_appeal(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    good = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(good), "n1")
    mock_attestation(direct_vm, good)
    contract.submit_attestation(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    assert deal(contract, deal_id)["release_bps"] == 10000

    corrected = attestation_report(5000, "n2")
    contract.commit_attestation(deal_id, report_digest(corrected), "n2")
    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected)

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["uptime_bps"] == 5000
    assert view["release_bps"] == 5050
    assert stats(contract)["conserved"] is True


def test_finalize_falls_back_instead_of_getting_stuck_on_a_dead_source(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    good = attestation_report(10000, "n1")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(good), "n1")
    mock_attestation(direct_vm, good)
    contract.submit_attestation(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    corrected = attestation_report(5000, "n2")
    contract.commit_attestation(deal_id, report_digest(corrected), "n2")
    direct_vm.clear_mocks()
    mock_attestation(direct_vm, corrected, status=503)

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)

    view = deal(contract, deal_id)
    assert view["status"] == "FINALIZED"
    assert view["release_bps"] == 10000  # tentative verdict stands
    assert stats(contract)["conserved"] is True


# ---------------------------------------------------------------- lapse


def test_claim_lapsed_refunds_only_after_the_grace(warp, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.warp(at(WINDOW_SECONDS + 10))
    with direct_vm.expect_revert("has not lapsed"):
        contract.claim_lapsed(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS + 86400 + 10))
    contract.claim_lapsed(deal_id)
    view = deal(contract, deal_id)
    assert view["status"] == "REFUNDED"
    confirm_all_payouts(direct_vm, contract, deal_id)
    assert stats(contract)["total_refunded_atto"] == str(ESCROW)
    assert stats(contract)["conserved"] is True


def test_settle_refuses_thin_coverage_then_lapse_refunds(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)

    # One UP probe out of four slots is 2500 bps, under the default 5000 floor.
    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    direct_vm.warp(at(WINDOW_SECONDS))
    with direct_vm.expect_revert("coverage is below the committed floor"):
        contract.settle(deal_id)

    direct_vm.warp(at(WINDOW_SECONDS + 86400 + 10))
    contract.claim_lapsed(deal_id)
    assert deal(contract, deal_id)["status"] == "REFUNDED"
    confirm_all_payouts(direct_vm, contract, deal_id)
    report = stats(contract)
    assert report["total_refunded_atto"] == str(ESCROW)
    assert report["total_released_atto"] == "0"
    assert report["conserved"] is True


def test_claim_lapsed_refuses_when_coverage_is_authoritative(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200])  # 2/4 = 5000 bps
    direct_vm.warp(at(WINDOW_SECONDS + 86400 + 10))
    with direct_vm.expect_revert("has enough probe coverage"):
        contract.claim_lapsed(deal_id)


# ---------------------------------------------------------------- payouts


def test_finalize_decides_but_does_not_book_delivery(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)

    report = stats(contract)
    assert report["held_atto"] == str(ESCROW)
    assert report["total_released_atto"] == "0"
    assert report["total_refunded_atto"] == "0"
    assert report["pending_payouts"] == 1
    assert report["unreconciled_payouts"] == 1
    assert report["conserved"] is True

    rows = payouts(contract, deal_id)
    assert len(rows) == 1
    assert rows[0]["kind"] == "provider"
    assert rows[0]["state"] == "sent"
    assert rows[0]["amount_atto"] == str(ESCROW)
    assert deal(contract, deal_id)["paid_atto"] == "0"


def test_failed_transfer_returns_to_owed_and_can_be_retried(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)

    direct_vm.value = ESCROW
    contract.__on_errored_message__()
    direct_vm.value = 0

    row = payouts(contract, deal_id)[0]
    assert row["state"] == "owed"
    assert row["returned_atto"] == str(ESCROW)
    report = stats(contract)
    assert report["held_atto"] == str(ESCROW)
    assert report["total_released_atto"] == "0"
    assert report["total_returned_atto"] == str(ESCROW)
    assert report["unreconciled_payouts"] == 0

    direct_vm.sender = direct_bob
    contract.retry_payout(deal_id, "provider")
    assert payouts(contract, deal_id)[0]["state"] == "sent"

    direct_vm.deal(direct_vm._contract_address, 0)
    contract.confirm_payout(deal_id, "provider")
    report = stats(contract)
    assert report["held_atto"] == "0"
    assert report["total_released_atto"] == str(ESCROW)
    assert report["pending_payouts"] == 0
    assert report["conserved"] is True
    assert deal(contract, deal_id)["paid_atto"] == str(ESCROW)

    contract.confirm_payout(deal_id, "provider")  # idempotent
    assert stats(contract)["total_released_atto"] == str(ESCROW)


def test_recover_payout_waits_for_grace_and_returns_an_undelivered_attempt(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)

    with direct_vm.expect_revert("inside its grace period"):
        contract.recover_payout(deal_id, "provider")

    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1 + 3600 + 1))
    contract.recover_payout(deal_id, "provider")
    row = payouts(contract, deal_id)[0]
    assert row["state"] == "owed"
    assert stats(contract)["total_released_atto"] == "0"

    direct_vm.sender = direct_bob
    contract.retry_payout(deal_id, "provider")
    direct_vm.deal(direct_vm._contract_address, 0)
    contract.confirm_payout(deal_id, "provider")
    assert stats(contract)["total_released_atto"] == str(ESCROW)


def test_recover_refuses_a_delivered_payout(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)

    direct_vm.deal(direct_vm._contract_address, 0)
    contract.confirm_payout(deal_id, "provider")
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1 + 3600 + 1))
    with direct_vm.expect_revert("was delivered; confirm_payout instead"):
        contract.recover_payout(deal_id, "provider")


def test_only_the_beneficiary_can_retry(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 200, 200, 200])
    direct_vm.warp(at(WINDOW_SECONDS))
    contract.settle(deal_id)
    direct_vm.warp(at(WINDOW_SECONDS + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    direct_vm.value = ESCROW
    contract.__on_errored_message__()
    direct_vm.value = 0

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only the payout beneficiary"):
        contract.retry_payout(deal_id, "provider")


def test_split_payout_serialises_provider_then_client(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)
    run_probes(direct_vm, contract, deal_id, [200, 503, 200, 503])  # 5000 bps
    settle_and_finalize(direct_vm, contract, deal_id)

    provider_cut = ESCROW * 5050 // 10000
    client_cut = ESCROW - provider_cut
    rows = payouts(contract, deal_id)
    assert {row["kind"] for row in rows} == {"provider", "client"}
    assert all(row["state"] == "delivered" for row in rows)

    report = stats(contract)
    assert report["held_atto"] == "0"
    assert report["total_released_atto"] == str(provider_cut)
    assert report["total_refunded_atto"] == str(client_cut)
    assert report["lifetime_outflow_atto"] == str(ESCROW)
    assert report["pending_payouts"] == 0
    assert report["conserved"] is True


# ---------------------------------------------------------------- config


def test_get_config_publishes_the_equivalence_rule(warp, direct_vm, direct_deploy):
    contract = direct_deploy(CONTRACT)
    config = json.loads(contract.get_config())
    assert config["max_slots"] == 720
    assert config["probe_grace_sec"] == 300
    assert config["appeal_window_sec"] == APPEAL_WINDOW_SEC
    assert config["min_appeal_bond_atto"] == 10 ** 15
    assert config["payout_grace_sec"] == 3600
    assert config["equivalence"]["probe"].startswith("derived UP/DOWN")
