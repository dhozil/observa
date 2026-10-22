"""Integration tests: Observa executed through real consensus.

Direct-mode tests pin the logic down in-process. These prove the same paths settle
when a real validator committee re-derives each decision, including a real web
fetch of the monitored endpoint. They run through the gltest CLI, which loads
gltest.config.yaml and selects the network:

    gltest tests/integration -v -s --network studionet

    # including the one that waits out a whole SLA window
    gltest tests/integration -v -s -m slow --network studionet

The guard rails live in this module rather than in a tests/integration/conftest.py
on purpose: this repository already has a tests/conftest.py, and two conftest files
in the same pytest run both import under the module name ``conftest``, which raises
an import-file-mismatch. One conftest, one set of rails.
"""

import itertools
import json
import os
import pathlib
import shutil
import sys
import time

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT_SOURCE = REPO_ROOT / "contracts" / "observa.py"
# Beside the real contract, because gltest resolves a contract path relative to its
# configured contracts directory and a file elsewhere is invisible to it.
STAGING = REPO_ROOT / "contracts" / ".integration"

_counter = itertools.count(1)

GEN = 10 ** 18
ESCROW = GEN // 100
SERVICE = "Public status endpoint"
ENDPOINT = "https://example.com"
MONITOR_URL = "https://example.com/report"


def terms_json(window_seconds: int = 3600, slots: int = 4) -> str:
    return json.dumps(
        {
            "service": SERVICE,
            "endpoint": ENDPOINT,
            "window_seconds": window_seconds,
            "slots": slots,
            "uptime_target_bps": 9900,
        },
        sort_keys=True,
    )


# --------------------------------------------------------------- guard rails


def _rpc_url() -> str:
    override = os.environ.get("GENLAYER_RPC")
    if override:
        return override
    try:
        from gltest_cli.config.general import get_general_config

        url = get_general_config().get_rpc_url()
        if url:
            return str(url)
    except Exception:
        pass
    return "https://studio.genlayer.com/api"


def _post(url: str, method: str, params: list, timeout: float = 20.0):
    import requests

    response = requests.post(
        url,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def _reachable(url: str, timeout: float = 15.0) -> bool:
    try:
        payload = _post(url, "eth_chainId", [], timeout=timeout)
    except Exception:
        return False
    return "result" in payload


def staged_contract() -> str:
    """A fresh copy of the contract per deploy, relative to the contracts dir.

    A local simulator's engine only honours ``@allow_storage`` on a module it has
    not already loaded, so a repeated deploy of one file fails for reasons that have
    nothing to do with the contract. On Studionet the extra comment is harmless.
    """
    tag = next(_counter)
    STAGING.mkdir(parents=True, exist_ok=True)
    target = STAGING / f"observa_{tag}.py"
    shutil.copyfile(CONTRACT_SOURCE, target)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(f"\n# integration deploy {tag}: a unique source, so the engine loads a fresh module\n")
    return str(target.relative_to(REPO_ROOT / "contracts"))


@pytest.fixture(scope="session", autouse=True)
def require_genlayer_network():
    # genlayer-test reaches Studionet through `requests`; a hand-rolled urllib probe
    # hits Cloudflare error 1010 in front of studio.genlayer.com. This uses requests.
    if pathlib.Path(sys.argv[0]).stem.lower() != "gltest":
        pytest.skip(
            "These run through the gltest CLI, which loads gltest.config.yaml and picks"
            " the network. Plain pytest cannot deploy in Studio mode:\n\n"
            "  gltest tests/integration -v -s --network studionet\n"
        )
    url = _rpc_url()
    if not _reachable(url):
        pytest.skip(
            f"No GenLayer node answered at {url}. Point the suite at one:\n"
            "  gltest tests/integration -v -s --network studionet\n"
            "Or a local node with GENLAYER_RPC=http://127.0.0.1:4000/api"
        )
    yield
    shutil.rmtree(STAGING, ignore_errors=True)


# ------------------------------------------------------------------- helpers


def deploy_observa(account):
    """Deploy and return a handle that really has methods on it.

    genlayer-test builds the handle's methods from a schema it fetches over RPC
    through a fallback chain; against some nodes that fetch comes back empty and the
    handle has no methods. Building from the factory's schema directly is the same
    construction without the fallback chain, and the assertion turns a schema
    problem into a clear message rather than a confusing missing attribute later.
    """
    from gltest.contracts.contract import Contract
    from gltest.utils import extract_contract_address

    factory = get_contract_factory(contract_file_path=staged_contract())
    receipt = factory.deploy_contract_tx(args=[], account=account)
    schema = factory._get_schema_with_fallback()
    if not isinstance(schema, dict) or not schema.get("methods"):
        raise AssertionError("gltest produced no contract schema, so no method can be called")
    contract = Contract.new(address=extract_contract_address(receipt), schema=schema, account=account)
    assert hasattr(contract, "open_deal"), "the deployed contract has no open_deal"
    return contract


def as_account(contract, account):
    """The same contract reached from a different sender.

    genlayer-test binds the account to the handle instead of taking it per call, so a
    write from a second party needs a second handle. Reusing the schema the handle
    already carries avoids another RPC round trip against a rate-limited node.
    """
    from gltest.contracts.contract import Contract

    return Contract.new(address=contract.address, schema=contract._schema, account=account)


def open_fund_start(client, provider_address, terms: str, escrow=ESCROW):
    """Open deal s1, fund it and start the window. Deal ids are deterministic."""
    opened = client.open_deal(args=[provider_address, terms]).transact()
    assert tx_execution_succeeded(opened)
    funded = client.fund_deal(args=["s1"]).transact(value=escrow)
    assert tx_execution_succeeded(funded)
    return "s1"


def stats(contract):
    return json.loads(contract.get_stats().call())


def deal(contract, deal_id="s1"):
    return json.loads(contract.get_deal(args=[deal_id]).call())


def payouts(contract, deal_id="s1"):
    return json.loads(contract.get_payouts(args=[deal_id]).call())


def assert_payout_conservation(report, rows):
    """Delivery totals move only for rows the contract booked as delivered.

    The child transfer is asynchronous even after `finalize` is finalized, so the
    test accepts a still-pending row but still proves the money invariant and that
    every decided obligation is represented.
    """
    delivered = {"provider": 0, "client": 0, "bond": 0}
    pending = 0
    for row in rows:
        if row["state"] == "delivered":
            delivered[row["kind"]] += int(row["amount_atto"])
        else:
            pending += int(row["amount_atto"])
    assert int(report["held_atto"]) == pending
    assert int(report["total_released_atto"]) == delivered["provider"]
    assert int(report["total_refunded_atto"]) == delivered["client"]
    assert report["conserved"] is True


# -------------------------------------------------------------------- no web


def test_deploy_open_and_fund(default_account, accounts):
    client = deploy_observa(default_account)
    deal_id = open_fund_start(client, accounts[1].address, terms_json())

    view = deal(client, deal_id)
    assert view["status"] == "FUNDED"
    assert view["escrow_atto"] == str(ESCROW)
    assert view["client"].lower() == default_account.address.lower()
    assert view["provider"].lower() == accounts[1].address.lower()
    assert client.get_deal_count().call() == 1
    assert stats(client)["conserved"] is True


def test_invalid_terms_are_rejected(default_account, accounts):
    client = deploy_observa(default_account)
    rejected = client.open_deal(args=[accounts[1].address, '{"service": "x"}']).transact()
    assert not tx_execution_succeeded(rejected)
    assert client.get_deal_count().call() == 0


def test_start_requires_the_provider(default_account, accounts):
    client = deploy_observa(default_account)
    provider = as_account(client, accounts[1])
    deal_id = open_fund_start(client, accounts[1].address, terms_json())

    rejected = client.start_deal(args=[deal_id]).transact()
    assert not tx_execution_succeeded(rejected)

    assert tx_execution_succeeded(provider.start_deal(args=[deal_id]).transact())
    assert deal(client, deal_id)["status"] == "ACTIVE"


def test_cancel_refunds_the_client(default_account, accounts):
    client = deploy_observa(default_account)
    deal_id = open_fund_start(client, accounts[1].address, terms_json())
    assert tx_execution_succeeded(client.cancel_deal(args=[deal_id]).transact())

    view = deal(client, deal_id)
    assert view["status"] == "REFUNDED"
    info = payouts(client, deal_id)
    assert len(info["payouts"]) == 1
    assert info["payouts"][0]["kind"] == "client"
    assert info["payouts"][0]["amount_atto"] == str(ESCROW)
    assert info["payouts"][0]["state"] in ("sent", "delivered")
    assert_payout_conservation(stats(client), info["payouts"])


# ------------------------------------------------------------------ consensus


def test_probe_settles_by_real_consensus(default_account, accounts):
    """A permissionless probe with a real web fetch: the committee independently
    reaches the endpoint and agrees on UP, and that reading is committed on-chain."""
    client = deploy_observa(default_account)
    provider = as_account(client, accounts[1])
    deal_id = open_fund_start(client, accounts[1].address, terms_json())
    assert tx_execution_succeeded(provider.start_deal(args=[deal_id]).transact())

    probed = client.probe_slot(args=[deal_id, 0]).transact()
    assert tx_execution_succeeded(probed)

    view = deal(client, deal_id)
    assert view["probed_slots"] == 1
    assert view["up_slots"] == 1
    log = json.loads(client.get_monitor_log(args=[deal_id]).call())
    assert log[0]["s"] == "UP"
    assert log[0]["http"] == 200


def test_bonded_appeal_settles_by_consensus(default_account, accounts):
    """The full Phase 4 lifecycle: probe, settle to a tentative verdict, appeal with
    a bond, re-derive, and finalize. Real consensus runs the probe's web fetch."""
    client = deploy_observa(default_account)
    provider = as_account(client, accounts[1])
    window = 2
    deal_id = open_fund_start(client, accounts[1].address, terms_json(window_seconds=window, slots=1))
    assert tx_execution_succeeded(provider.start_deal(args=[deal_id]).transact())
    assert tx_execution_succeeded(client.probe_slot(args=[deal_id, 0]).transact())

    time.sleep(window + 4)
    assert tx_execution_succeeded(client.settle(args=[deal_id]).transact())
    assert deal(client, deal_id)["status"] == "RESOLVED"
    assert stats(client)["held_atto"] == str(ESCROW)  # nothing moves until finalize

    bond = ESCROW * 2500 // 10000
    assert tx_execution_succeeded(client.appeal(args=[deal_id]).transact(value=bond))
    assert deal(client, deal_id)["status"] == "APPEALED"
    assert tx_execution_succeeded(client.resolve_appeal(args=[deal_id]).transact())
    assert deal(client, deal_id)["final"] is True
    assert tx_execution_succeeded(client.finalize(args=[deal_id]).transact())

    view = deal(client, deal_id)
    assert view["status"] == "FINALIZED"
    assert view["outcome"] == "MET"
    info = payouts(client, deal_id)
    rows = {row["kind"]: row for row in info["payouts"]}
    assert rows["provider"]["amount_atto"] == str(ESCROW)
    assert "client" not in rows  # a zero cut creates no payout row
    assert rows["bond"]["amount_atto"] == str(bond)
    assert_payout_conservation(stats(client), info["payouts"])


@pytest.mark.slow
def test_settle_after_a_short_window(default_account, accounts):
    """The load-bearing end-to-end test: probe, wait out a real 45s window, settle,
    contest the tentative verdict with a bond, re-derive, finalize, and confirm the
    escrow is split by the measured uptime with conservation held."""
    client = deploy_observa(default_account)
    provider = as_account(client, accounts[1])
    window = 45
    deal_id = open_fund_start(client, accounts[1].address, terms_json(window_seconds=window, slots=1))
    assert tx_execution_succeeded(provider.start_deal(args=[deal_id]).transact())

    assert tx_execution_succeeded(client.probe_slot(args=[deal_id, 0]).transact())

    time.sleep(window + 10)
    settled = client.settle(args=[deal_id]).transact()
    assert tx_execution_succeeded(settled)
    assert deal(client, deal_id)["status"] == "RESOLVED"

    # A bond forces the re-derivation; with no new evidence the verdict stands.
    bond = ESCROW * 2500 // 10000
    assert tx_execution_succeeded(client.appeal(args=[deal_id]).transact(value=bond))
    assert tx_execution_succeeded(client.resolve_appeal(args=[deal_id]).transact())
    assert tx_execution_succeeded(client.finalize(args=[deal_id]).transact())

    view = deal(client, deal_id)
    assert view["status"] == "FINALIZED"
    assert view["outcome"] == "MET"
    assert view["uptime_bps"] == 10000
    info = payouts(client, deal_id)
    rows = {row["kind"]: row for row in info["payouts"]}
    assert rows["provider"]["amount_atto"] == str(ESCROW)
    assert rows["bond"]["amount_atto"] == str(bond)
    assert_payout_conservation(stats(client), info["payouts"])
