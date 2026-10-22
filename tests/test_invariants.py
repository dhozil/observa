"""Property-style and adversarial checks for Observa.

The randomized batch exercises the money invariant across mixed lifecycles:
cancel, probe settlement, bonded appeal with a late probe, attestation, and
inconclusive lapse. Every path is driven through the public methods only, and
the books are asserted after each deal.

The adversarial cases pin the two evidence races that matter: a client lapse
must not be reversible by a late attestation, and an already-recorded
attestation must not be refunded as if the deal had lapsed.
"""

import json
import random
from datetime import datetime, timezone

from conftest import (
    APPEAL_WINDOW_SEC,
    CONTRACT,
    ESCROW,
    GEN,
    LAPSE_GRACE_SEC,
    SLOT_SECONDS,
    active_deal,
    attestation_report,
    confirm_all_payouts,
    file_appeal,
    hx,
    mock_attestation,
    mock_probe,
    open_deal,
    report_digest,
    sla_terms,
)

MONITOR = "direct_charlie"


def stats(contract):
    return json.loads(contract.get_stats())


def deal(contract, deal_id):
    return json.loads(contract.get_deal(deal_id))


def payouts(contract, deal_id):
    return json.loads(contract.get_payouts(deal_id))["payouts"]


def iso(ts):
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


def assert_books(contract):
    report = stats(contract)
    held = int(report["held_atto"])
    owed = int(report["owed_atto"])
    in_flight = int(report["in_flight_atto"])
    assert report["conserved"] is True
    assert held == int(report["lifetime_inflow_atto"]) - int(report["lifetime_outflow_atto"])
    assert held == owed + in_flight
    return report


def assert_delivered(contract, deal_id, expected_atto, allowed_kinds):
    rows = payouts(contract, deal_id)
    assert rows
    assert {row["kind"] for row in rows} <= set(allowed_kinds)
    assert all(row["state"] == "delivered" for row in rows)
    assert sum(int(row["amount_atto"]) for row in rows) == expected_atto
    return rows


def probe_at_start(vm, contract, deal_id, statuses):
    started = int(deal(contract, deal_id)["started_at_unix"])
    for index, status in enumerate(statuses):
        vm.warp(iso(started + index * SLOT_SECONDS))
        vm.clear_mocks()
        mock_probe(vm, status=status)
        contract.probe_slot(deal_id, index)


def test_books_hold_across_mixed_random_lifecycles(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    expected_released = 0
    expected_refunded = 0
    expected_outflow = 0

    for seed in range(20):
        rng = random.Random(seed)
        path = seed % 5
        escrow = rng.choice([GEN, 3 * GEN, 10 * GEN]) + rng.randrange(0, 1000)
        target = rng.choice([5000, 9000, 10000])
        direct_vm.clear_mocks()
        direct_vm.value = 0

        if path == 0:
            # Client exits before the provider starts.
            direct_vm.sender = direct_alice
            deal_id = open_deal(direct_vm, contract, hx(direct_bob), escrow=escrow)
            contract.cancel_deal(deal_id)
            confirm_all_payouts(direct_vm, contract, deal_id)
            assert_delivered(contract, deal_id, escrow, ["client"])
            expected_refunded += escrow
            expected_outflow += escrow

        elif path == 1:
            # Probe settlement with no appeal.
            deal_id = active_deal(
                direct_vm,
                contract,
                direct_alice,
                direct_bob,
                terms=sla_terms(uptime_target_bps=target),
                escrow=escrow,
            )
            statuses = [rng.choice([200, 200, 503]) for _ in range(4)]
            probe_at_start(direct_vm, contract, deal_id, statuses)
            view = deal(contract, deal_id)
            direct_vm.warp(iso(view["end_unix"]))
            contract.settle(deal_id)
            direct_vm.warp(iso(view["end_unix"] + APPEAL_WINDOW_SEC + 1))
            contract.finalize(deal_id)
            confirm_all_payouts(direct_vm, contract, deal_id)

            rows = {row["kind"]: int(row["amount_atto"]) for row in assert_delivered(
                contract, deal_id, escrow, ["provider", "client"]
            ) if row["kind"] in ("provider", "client")}
            expected_released += rows.get("provider", 0)
            expected_refunded += rows.get("client", 0)
            expected_outflow += escrow

        elif path == 2:
            # Bonded appeal, with slot 3 filed late during the appeal window.
            deal_id = active_deal(
                direct_vm,
                contract,
                direct_alice,
                direct_bob,
                terms=sla_terms(uptime_target_bps=target),
                escrow=escrow,
            )
            statuses = [rng.choice([200, 503]) for _ in range(3)]
            probe_at_start(direct_vm, contract, deal_id, statuses)
            view = deal(contract, deal_id)
            direct_vm.warp(iso(view["end_unix"]))
            contract.settle(deal_id)

            direct_vm.warp(iso(view["end_unix"] + 5))
            direct_vm.clear_mocks()
            mock_probe(direct_vm, status=rng.choice([200, 503]))
            direct_vm.sender = rng.choice([direct_alice, direct_bob])
            contract.probe_slot(deal_id, 3)

            appellant = rng.choice([direct_alice, direct_bob])
            bond = int(deal(contract, deal_id)["escrow_atto"]) * 2500 // 10000
            bond = max(bond, 10 ** 15)
            file_appeal(direct_vm, contract, appellant, deal_id, bond=bond)
            contract.resolve_appeal(deal_id)

            direct_vm.warp(iso(view["end_unix"] + APPEAL_WINDOW_SEC + 1))
            contract.finalize(deal_id)
            confirm_all_payouts(direct_vm, contract, deal_id)

            rows = {row["kind"]: int(row["amount_atto"]) for row in assert_delivered(
                contract, deal_id, escrow + bond, ["provider", "client", "bond"]
            ) if row["kind"] in ("provider", "client")}
            expected_released += rows.get("provider", 0)
            expected_refunded += rows.get("client", 0)
            expected_outflow += escrow + bond

        elif path == 3:
            # Attestation-only settlement.
            deal_id = active_deal(
                direct_vm,
                contract,
                direct_alice,
                direct_bob,
                terms=sla_terms(monitor=direct_charlie, uptime_target_bps=target),
                escrow=escrow,
            )
            report = attestation_report(rng.choice([0, 5000, 9900, 10000]), "n" + str(seed))
            direct_vm.sender = direct_charlie
            contract.commit_attestation(deal_id, report_digest(report), "n" + str(seed))
            mock_attestation(direct_vm, report)
            contract.submit_attestation(deal_id)

            view = deal(contract, deal_id)
            direct_vm.warp(iso(view["end_unix"]))
            contract.settle(deal_id)
            direct_vm.warp(iso(view["end_unix"] + APPEAL_WINDOW_SEC + 1))
            contract.finalize(deal_id)
            confirm_all_payouts(direct_vm, contract, deal_id)

            rows = {row["kind"]: int(row["amount_atto"]) for row in assert_delivered(
                contract, deal_id, escrow, ["provider", "client"]
            ) if row["kind"] in ("provider", "client")}
            expected_released += rows.get("provider", 0)
            expected_refunded += rows.get("client", 0)
            expected_outflow += escrow

        else:
            # Thin or absent probes cannot decide the SLA; the client lapses out.
            deal_id = active_deal(
                direct_vm,
                contract,
                direct_alice,
                direct_bob,
                terms=sla_terms(uptime_target_bps=target),
                escrow=escrow,
            )
            if rng.random() < 0.5:
                probe_at_start(direct_vm, contract, deal_id, [200])
            view = deal(contract, deal_id)
            direct_vm.warp(iso(view["end_unix"] + LAPSE_GRACE_SEC + 1))
            contract.claim_lapsed(deal_id)
            confirm_all_payouts(direct_vm, contract, deal_id)
            assert_delivered(contract, deal_id, escrow, ["client"])
            expected_refunded += escrow
            expected_outflow += escrow

        report = assert_books(contract)
        assert int(report["held_atto"]) == 0
        assert int(report["pending_payouts"]) == 0
        assert int(report["total_released_atto"]) == expected_released
        assert int(report["total_refunded_atto"]) == expected_refunded
        assert int(report["lifetime_outflow_atto"]) == expected_outflow
        assert int(report["total_released_atto"]) + int(report["total_refunded_atto"]) <= expected_outflow


def test_lapse_refund_cannot_be_reversed_by_a_late_attestation(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    direct_vm.warp(iso(deal(contract, deal_id)["end_unix"] + LAPSE_GRACE_SEC + 1))
    contract.claim_lapsed(deal_id)
    assert deal(contract, deal_id)["status"] == "REFUNDED"

    report = attestation_report(10000, "late")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("is not active"):
        contract.commit_attestation(deal_id, report_digest(report), "late")

    confirm_all_payouts(direct_vm, contract, deal_id)
    assert_delivered(contract, deal_id, ESCROW, ["client"])
    assert_books(contract)
    assert stats(contract)["held_atto"] == "0"


def test_recorded_attestation_blocks_a_lapse_refund(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(
        direct_vm, contract, direct_alice, direct_bob, terms=sla_terms(monitor=direct_charlie)
    )
    report = attestation_report(10000, "early")
    direct_vm.sender = direct_charlie
    contract.commit_attestation(deal_id, report_digest(report), "early")
    mock_attestation(direct_vm, report)
    contract.submit_attestation(deal_id)

    direct_vm.warp(iso(deal(contract, deal_id)["end_unix"] + LAPSE_GRACE_SEC + 1))
    with direct_vm.expect_revert("has an attestation"):
        contract.claim_lapsed(deal_id)

    direct_vm.warp(iso(deal(contract, deal_id)["end_unix"]))
    contract.settle(deal_id)
    direct_vm.warp(iso(deal(contract, deal_id)["resolved_at_unix"] + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(direct_vm, contract, deal_id)
    assert_delivered(contract, deal_id, ESCROW, ["provider"])
    assert_books(contract)


def test_provider_cannot_backfill_a_closed_probe_slot(
    warp, direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy(CONTRACT)
    deal_id = active_deal(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("is not open yet"):
        contract.probe_slot(deal_id, 1)

    mock_probe(direct_vm, status=200)
    contract.probe_slot(deal_id, 0)
    with direct_vm.expect_revert("has already been probed"):
        contract.probe_slot(deal_id, 0)

    direct_vm.warp(iso(deal(contract, deal_id)["end_unix"] + 301))
    with direct_vm.expect_revert("has closed"):
        contract.probe_slot(deal_id, 1)

    log = json.loads(contract.get_monitor_log(deal_id))
    assert log[0] == {"s": "UP", "http": 200}
    assert log[1] is None
    assert deal(contract, deal_id)["probed_slots"] == 1
