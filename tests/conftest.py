"""Shared fixtures and helpers for the direct-mode test suite."""

import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

GEN = 10 ** 18
CONTRACT = "contracts/observa.py"
BASE_DT = datetime(2031, 3, 1, 0, 0, 0, tzinfo=timezone.utc)
BASE_ISO = BASE_DT.isoformat()

ENDPOINT = "https://api.example.org/health"
ATTEST_URL = "https://attestor.example.net/report"
PROBE_PATTERN = r"api\.example\.org"
ATTEST_PATTERN = r"attestor\.example\.net"

WINDOW_SECONDS = 3600
SLOTS = 4
SLOT_SECONDS = WINDOW_SECONDS // SLOTS  # 900
ESCROW = 10 * GEN
APPEAL_WINDOW_SEC = 3600
LAPSE_GRACE_SEC = 86400
APPEAL_BOND_BPS = 2500
APPEAL_BOND = ESCROW * APPEAL_BOND_BPS // 10000


def hx(address) -> str:
    """Normalise a fixture address (Address or bytes) to a 0x hex string."""
    if hasattr(address, "as_bytes"):
        return "0x" + address.as_bytes.hex()
    if isinstance(address, bytes):
        return "0x" + address.hex()
    return str(address)


def ts(dt: datetime) -> int:
    return int(dt.timestamp())


def at(seconds: int) -> str:
    """An ISO timestamp `seconds` after BASE_DT, for direct_vm.warp()."""
    return (BASE_DT + timedelta(seconds=seconds)).isoformat()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def sla_terms(
    endpoint=ENDPOINT,
    window_seconds=WINDOW_SECONDS,
    slots=SLOTS,
    uptime_target_bps=9900,
    min_coverage_bps=None,
    expect_status=0,
    monitor=None,
    attestation_url="",
    **extra,
) -> str:
    doc = {
        "service": "Acme Payments API",
        "endpoint": endpoint,
        "window_seconds": window_seconds,
        "slots": slots,
        "uptime_target_bps": uptime_target_bps,
    }
    if min_coverage_bps is not None:
        doc["min_coverage_bps"] = min_coverage_bps
    if expect_status:
        doc["expect_status"] = expect_status
    if monitor is not None:
        doc["monitor"] = hx(monitor)
        if not attestation_url:
            attestation_url = ATTEST_URL
    if attestation_url:
        doc["attestation_url"] = attestation_url
    doc.update(extra)
    return json.dumps(doc, sort_keys=True)


def mock_probe(vm, status=200, body="ok", pattern=PROBE_PATTERN):
    vm.mock_web(pattern, {"status": status, "body": body})


def attestation_report(uptime_bps=10000, nonce="att-1"):
    return {"uptime_bps": uptime_bps, "nonce": nonce, "service": "Acme Payments API"}


def report_digest(report) -> str:
    return hashlib.sha256(canonical(report).encode("utf-8")).hexdigest()


def mock_attestation(vm, report, status=200, pattern=ATTEST_PATTERN):
    vm.mock_web(pattern, {"status": status, "body": canonical(report)})


@pytest.fixture
def warp(direct_vm):
    direct_vm.warp(BASE_ISO)
    return direct_vm


def sync_contract_balance(vm, contract):
    """Mirror the live host balance in direct mode (which never credits funding)."""
    held = int(json.loads(contract.get_stats())["held_atto"])
    vm.deal(vm._contract_address, held)


def confirm_all_payouts(vm, contract, deal_id):
    """Simulate each child transfer landing, then confirm it on-chain."""
    while True:
        rows = json.loads(contract.get_payouts(deal_id))["payouts"]
        sent = [row for row in rows if row["state"] == "sent"]
        if not sent:
            return
        row = sent[0]
        target = int(row["balance_at_emit"]) - int(row["amount_atto"])
        vm.deal(vm._contract_address, max(0, target))
        contract.confirm_payout(deal_id, row["kind"])


def open_deal(vm, contract, provider_hex, terms=None, escrow=ESCROW):
    """Open and fund a deal. The current vm.sender must already be the client."""
    deal_id = contract.open_deal(provider_hex, terms or sla_terms())
    vm.value = escrow
    contract.fund_deal(deal_id)
    vm.value = 0
    sync_contract_balance(vm, contract)
    return deal_id


def active_deal(vm, contract, client, provider, terms=None, escrow=ESCROW):
    """Drive a deal to ACTIVE with a fresh monitoring window at BASE_DT."""
    vm.sender = client
    deal_id = open_deal(vm, contract, hx(provider), terms=terms, escrow=escrow)
    vm.sender = provider
    contract.start_deal(deal_id)
    vm.sender = client
    return deal_id


def run_probes(vm, contract, deal_id, statuses, slot_seconds=SLOT_SECONDS):
    """Probe each slot at its own open time with the supplied HTTP statuses."""
    for index, status in enumerate(statuses):
        vm.warp(at(index * slot_seconds))
        vm.clear_mocks()
        mock_probe(vm, status=status)
        contract.probe_slot(deal_id, index)


def settle_and_finalize(vm, contract, deal_id, settle_at=WINDOW_SECONDS):
    """Settle, wait out the appeal window with nobody appealing, then finalize."""
    vm.warp(at(settle_at))
    contract.settle(deal_id)
    vm.warp(at(settle_at + APPEAL_WINDOW_SEC + 1))
    contract.finalize(deal_id)
    confirm_all_payouts(vm, contract, deal_id)


def file_appeal(vm, contract, sender, deal_id, bond=APPEAL_BOND):
    """Stake the appeal bond as `sender` (a party to the deal)."""
    vm.sender = sender
    vm.value = bond
    contract.appeal(deal_id)
    vm.value = 0
    sync_contract_balance(vm, contract)
