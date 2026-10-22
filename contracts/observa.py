# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from genlayer import *

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"

# Escrow lifecycle. OPEN -> FUNDED -> ACTIVE (the SLA window is open and can be
# probed), then one of:
#   * RESOLVED   - a tentative verdict exists and an appeal window is open, or an
#                  appeal was decided; waiting on finalize;
#   * APPEALED   - a party staked a bond to contest the tentative verdict;
#   * FINALIZED  - the verdict was paid out (release/refund split);
#   * REFUNDED   - the client exited, or the window lapsed with no evidence.
STATUS_OPEN = "OPEN"
STATUS_FUNDED = "FUNDED"
STATUS_ACTIVE = "ACTIVE"
STATUS_RESOLVED = "RESOLVED"
STATUS_APPEALED = "APPEALED"
STATUS_FINALIZED = "FINALIZED"
STATUS_REFUNDED = "REFUNDED"

OUTCOME_MET = "MET"
OUTCOME_BREACHED = "BREACHED"

PROBE_UP = "UP"
PROBE_DOWN = "DOWN"

# Payout delivery is asynchronous: emitting a transfer is a request, not proof
# that the beneficiary received it. A payout stays `owed` until an attempt is
# made, `sent` until delivery is observed, and only then `delivered`. A failed
# child transaction is reported through `__on_errored_message__`; if the callback
# never arrives, `recover_payout` may judge the attempt after this grace.
PAYOUT_OWED = "owed"
PAYOUT_SENT = "sent"
PAYOUT_DELIVERED = "delivered"
PAYOUT_GRACE_SEC = 3600
PAYOUT_PROVIDER = "provider"
PAYOUT_CLIENT = "client"
PAYOUT_BOND = "bond"

ZERO_ADDRESS_HEX = "0x0000000000000000000000000000000000000000"

MAX_SERVICE = 200
MAX_LOG = 500
ENTRY_CLIP = 1200
NONCE_CLIP = 120
MAX_SLOTS = 720
# A slot may be probed from its own start until a short grace after it ends, so a
# keeper whose transaction lands a moment late still lands in the right sample.
PROBE_GRACE_SEC = 300
# With no probe and no attestation at all, the client may recover the escrow only
# after this long, so a slow monitor cannot be pre-empted by a refund race.
LAPSE_GRACE_SEC = 86400
DEFAULT_MIN_COVERAGE_BPS = 5000
MIN_ESCROW_ATTO = 1
# A tentative verdict can be contested for this long before it finalizes. During
# the window late probes and a corrected attestation are admissible, and a party
# may stake a bond to force a re-derivation.
APPEAL_WINDOW_SEC = 3600
# An appeal bond is a fraction of the escrow, with a floor so a dust escrow cannot
# make an appeal free. The loser of the appeal forfeits the bond to the other side.
APPEAL_BOND_BPS = 2500
MIN_APPEAL_BOND_ATTO = 10 ** 15


@gl.evm.contract_interface
class _ChainAccount:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Deal:
    id: str
    client: Address
    provider: Address
    service: str
    endpoint: str
    terms_json: str
    terms_digest: str
    window_seconds: u64
    slots: u64
    slot_seconds: u64
    uptime_target_bps: u256
    min_coverage_bps: u256
    expect_status: u64
    monitor: Address
    attestation_url: str
    escrow_atto: u256
    status: str
    created_at_unix: u64
    funded_at_unix: u64
    started_at_unix: u64
    end_unix: u64
    probed_slots: u256
    up_slots: u256
    attested_digest: str
    attestation_nonce: str
    attested: bool
    attested_bps: u256
    attestation_at_unix: u64
    measured_bps: u256
    uptime_bps: u256
    release_bps: u256
    outcome: str
    settled: bool
    finalized_at_unix: u64
    paid_atto: u256
    # Settlement and appeal bookkeeping. `settle` writes a tentative verdict and
    # opens an appeal window; a bonded appeal (`appeal`) marks the deal APPEALED
    # and `resolve_appeal` re-derives it; only `finalize` moves money, so the
    # escrow plus any bond is always exactly what `held_atto` covers.
    resolved_at_unix: u64
    appeal_deadline_unix: u64
    first_release_bps: u256
    appellant: Address
    appeal_bond_atto: u256
    appeal_decided: bool
    final: bool
    # True when an appeal could not obtain a fresh attested reading and the
    # standing tentative verdict was kept. The bond is returned in that case:
    # the appellant is not penalised for a monitor/source outage.
    appeal_evidence_unavailable: bool


@allow_storage
@dataclass
class Payout:
    """One decided obligation, tracked separately from its delivery.

    `finalize` and `claim_lapsed` decide the split; this record carries the
    transfer until it is either observed delivered or returned by the platform.
    A payout is never marked delivered just because `emit_transfer` returned.
    """

    deal_id: str
    kind: str
    recipient: Address
    amount_atto: u256
    memo: str
    state: str
    attempts: u64
    sent_at_unix: u64
    balance_at_emit: u256
    inflow_at_emit: u256
    returned_atto: u256
    delivered_at_unix: u64


def _clip(value, limit: int) -> str:
    text = str(value).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def _to_address(value) -> Address:
    """Accept a hex string or an already decoded Address, as GenVM hands both."""
    if isinstance(value, Address):
        return value
    try:
        return Address(value)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} invalid address: {value}")


def _now_unix() -> int:
    # GenVM pins `datetime.now` to the transaction timestamp, so this is
    # deterministic across leader and validators (the direct harness can warp it).
    return int(datetime.now(timezone.utc).timestamp())


def _canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_zero_address(address: Address) -> bool:
    return str(address).lower() == ZERO_ADDRESS_HEX


def _require_int(raw, field: str) -> int:
    """Coerce a JSON scalar to int, refusing bools and non-integral floats."""
    if isinstance(raw, bool):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {field} must be an integer")
    if isinstance(raw, int):
        return int(raw)
    if isinstance(raw, float):
        if raw != int(raw):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {field} must be a whole number")
        return int(raw)
    if isinstance(raw, str):
        text = raw.strip()
        negative = text.startswith("-")
        if negative or text.startswith("+"):
            text = text[1:]
        if text.isdigit():
            value = int(text)
            return -value if negative else value
    raise gl.vm.UserError(f"{ERROR_EXPECTED} {field} must be an integer")


def _require_int_or(raw, field: str, default: int) -> int:
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return default
    return _require_int(raw, field)


def _parse_sla_terms(terms_json: str):
    """
    Validate a machine-readable SLA commitment and return its canonical form.

    An SLA is only as enforceable as its terms. Required: a `service` name, an
    HTTPS `endpoint`, a positive `window_seconds`, a `slots` count the window is
    sampled at, and an `uptime_target_bps` in (0, 10000]. Optional: a
    `min_coverage_bps` floor, an `expect_status`, and a `monitor` +
    `attestation_url` pair that enables the attested-report path. The canonical
    form is what the digest commits to, so the exact bytes both parties agreed to
    are provable later.
    """
    try:
        parsed = json.loads(str(terms_json))
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} terms_json is not valid JSON")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} terms_json must be a JSON object")

    service = str(parsed.get("service", "")).strip()
    if service == "":
        raise gl.vm.UserError(f"{ERROR_EXPECTED} terms must name a service")

    endpoint = str(parsed.get("endpoint", "")).strip()
    if not endpoint.startswith("https://"):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} endpoint must start with https://")

    window_seconds = _require_int(parsed.get("window_seconds"), "window_seconds")
    if window_seconds <= 0:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} window_seconds must be positive")

    slots = _require_int(parsed.get("slots"), "slots")
    if slots < 1 or slots > MAX_SLOTS:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} slots must be between 1 and {MAX_SLOTS}")
    if window_seconds < slots:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} window_seconds must be at least slots")

    uptime_target_bps = _require_int(parsed.get("uptime_target_bps"), "uptime_target_bps")
    if uptime_target_bps < 1 or uptime_target_bps > 10000:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} uptime_target_bps must be between 1 and 10000")

    min_coverage_bps = _require_int_or(parsed.get("min_coverage_bps"), "min_coverage_bps", DEFAULT_MIN_COVERAGE_BPS)
    if min_coverage_bps < 0 or min_coverage_bps > 10000:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} min_coverage_bps must be between 0 and 10000")

    expect_status = _require_int_or(parsed.get("expect_status"), "expect_status", 0)
    if expect_status != 0 and (expect_status < 100 or expect_status > 599):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} expect_status must be 0 or a valid HTTP status")

    attestation_url = str(parsed.get("attestation_url", "")).strip()
    monitor_raw = str(parsed.get("monitor", "")).strip()
    monitor = Address(ZERO_ADDRESS_HEX)
    if monitor_raw != "":
        monitor = _to_address(monitor_raw)
        if _is_zero_address(monitor):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} monitor must not be the zero address")
        if not attestation_url.startswith("https://"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} a monitor requires an https attestation_url")
    elif attestation_url != "" and not attestation_url.startswith("https://"):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} attestation_url must start with https://")

    canonical = _canonical_json(parsed)
    meta = {
        "service": _clip(service, MAX_SERVICE),
        "endpoint": _clip(endpoint, 512),
        "window_seconds": window_seconds,
        "slots": slots,
        "slot_seconds": window_seconds // slots,
        "uptime_target_bps": uptime_target_bps,
        "min_coverage_bps": min_coverage_bps,
        "expect_status": expect_status,
        "monitor": monitor,
        "attestation_url": _clip(attestation_url, 512),
    }
    return canonical, _digest(canonical), meta


def _http_status(response) -> int:
    for attribute in ("status_code", "status"):
        value = getattr(response, attribute, None)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
    return 200


def _response_text(response) -> str:
    body = getattr(response, "body", "")
    if isinstance(body, bytes):
        return body.decode("utf-8", "ignore")
    return str(body)


def _probe_once(endpoint: str, expect_status: int) -> dict:
    """
    Fetch the endpoint and derive UP/DOWN. Non-deterministic: leader/validator only.

    A connection error or any non-matching status is DOWN: that is precisely the
    SLA breach signal the client is escrowing against. Only the `s` field is
    consensus-bearing; `http` and `reachable` ride along as audit data.
    """
    try:
        response = gl.nondet.web.get(endpoint)
    except Exception:
        return {"s": PROBE_DOWN, "http": 0, "reachable": False}
    status = _http_status(response)
    if expect_status > 0:
        up = status == expect_status
    else:
        up = 200 <= status < 300
    return {"s": PROBE_UP if up else PROBE_DOWN, "http": status, "reachable": True}


def _attestation_once(url: str, committed_digest: str, expected: dict) -> dict:
    """
    Fetch the monitor's published report and bind it to its on-chain commitment.

    The report is only trusted when its canonical JSON hashes to the digest the
    monitor committed on-chain, which is what stands in for a signature the VM
    cannot check. It must also name the same deal, service, terms and observation
    window as the agreement: a digest only binds bytes, not the agreement those
    bytes describe. Error messages are deliberately static so that a leader and a
    validator that hit the same failure agree on the failure text.
    """
    try:
        response = gl.nondet.web.get(url)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} attestation unreachable")
    status = _http_status(response)
    if status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} attestation source unavailable")
    if status >= 400:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation source returned an error status")
    try:
        parsed = json.loads(_response_text(response))
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation is not valid JSON")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation must be a JSON object")
    digest = _digest(_canonical_json(parsed))
    if digest != committed_digest:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} attestation does not match the committed digest")
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
    uptime = _require_int(parsed.get("uptime_bps"), "uptime_bps")
    if uptime < 0:
        uptime = 0
    if uptime > 10000:
        uptime = 10000
    return {
        "uptime_bps": uptime,
        "nonce": _clip(str(parsed.get("nonce", "")), NONCE_CLIP),
        "digest": digest,
    }


@allow_storage
class Observa(gl.Contract):
    owner: Address
    deal_count: u256
    deals: TreeMap[str, Deal]
    deal_order: DynArray[str]
    # Per deal, one entry per SLA slot: "" (unprobed) or a JSON probe record.
    deal_slots: TreeMap[str, DynArray[str]]
    held_atto: u256
    lifetime_inflow: u256
    lifetime_outflow: u256
    total_released: u256
    total_refunded: u256
    event_log: DynArray[str]
    log_truncated: bool
    # Payout delivery ledger. Appended after the original fields so existing
    # storage layout is never shifted. `held_atto` continues to account for the
    # obligation until delivery is confirmed; `lifetime_outflow` moves only then.
    payouts: TreeMap[str, Payout]
    payout_queue: DynArray[str]
    total_returned: u256

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.deal_count = u256(0)
        self.held_atto = u256(0)
        self.lifetime_inflow = u256(0)
        self.lifetime_outflow = u256(0)
        self.total_released = u256(0)
        self.total_refunded = u256(0)
        self.log_truncated = False
        self.total_returned = u256(0)

    # ------------------------------------------------------------------ money

    def _payout_key(self, deal_id: str, kind: str) -> str:
        return str(deal_id) + ":" + str(kind)

    def _create_payout(self, deal_id: str, kind: str, recipient: Address, amount: int, memo: str) -> None:
        """
        Record a decided obligation. This does not move value or reduce held.
        """
        if amount <= 0:
            return
        key = self._payout_key(deal_id, kind)
        if key in self.payouts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {key} already exists")
        self.payouts[key] = Payout(
            deal_id=str(deal_id),
            kind=str(kind),
            recipient=recipient,
            amount_atto=u256(amount),
            memo=str(memo),
            state=PAYOUT_OWED,
            attempts=u64(0),
            sent_at_unix=u64(0),
            balance_at_emit=u256(0),
            inflow_at_emit=u256(0),
            returned_atto=u256(0),
            delivered_at_unix=u64(0),
        )
        self.payout_queue.append(key)
        self._log({
            "event": "payout_owed",
            "id": str(deal_id),
            "kind": str(kind),
            "to": str(recipient),
            "amount_atto": str(amount),
        })

    def _send_payout(self, payout: Payout) -> None:
        """
        Request one transfer, recording a balance snapshot before the emit.

        `emit_transfer` only creates a child transaction. Success here means the
        request was accepted, not that the recipient was paid, so the payout
        stays `sent` until `confirm_payout` observes the value leave.
        """
        if str(payout.state) != PAYOUT_OWED:
            return
        if self._in_flight_payout() is not None:
            return
        amount = int(payout.amount_atto)
        if amount <= 0:
            return
        if amount > int(self.held_atto):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout exceeds held value")
        payout.attempts = u64(int(payout.attempts) + 1)
        payout.sent_at_unix = u64(_now_unix())
        payout.balance_at_emit = u256(int(self.balance))
        payout.inflow_at_emit = u256(int(self.lifetime_inflow))
        try:
            _ChainAccount(payout.recipient).emit_transfer(value=u256(amount), on="finalized")
            payout.state = PAYOUT_SENT
            self._log({
                "event": "payout_sent",
                "id": str(payout.deal_id),
                "kind": str(payout.kind),
                "to": str(payout.recipient),
                "amount_atto": str(amount),
                "attempt": int(payout.attempts),
            })
        except Exception:
            payout.state = PAYOUT_OWED
            payout.sent_at_unix = u64(0)
            payout.balance_at_emit = u256(0)
            payout.inflow_at_emit = u256(0)
            self._log({
                "event": "payout_emit_failed",
                "id": str(payout.deal_id),
                "kind": str(payout.kind),
                "amount_atto": str(amount),
            })

    def _in_flight_payout(self):
        """The single `sent` payout, or None. The single-in-flight rule makes a
        returned value attributable without an id in the platform callback."""
        for key in self.payout_queue:
            payout = self.payouts[key]
            if str(payout.state) == PAYOUT_SENT:
                return payout
        return None

    def _delivered(self, payout: Payout) -> bool:
        """
        Has this payout's value observably left the contract?

        Net of value received after the attempt, so funding another deal does
        not make an undelivered payout look paid. This is arithmetic against a
        snapshot the contract took itself, not a caller claim.
        """
        received_since = int(self.lifetime_inflow) - int(payout.inflow_at_emit)
        if received_since < 0:
            received_since = 0
        return (
            int(self.balance) - received_since + int(payout.amount_atto)
            <= int(payout.balance_at_emit)
        )

    def _confirm_payout_record(self, payout: Payout) -> None:
        """Book a delivered payout exactly once and move the delivery totals."""
        if str(payout.state) != PAYOUT_SENT:
            return
        amount = int(payout.amount_atto)
        if amount > int(self.held_atto):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout exceeds held value")
        payout.state = PAYOUT_DELIVERED
        payout.delivered_at_unix = u64(_now_unix())
        payout.sent_at_unix = u64(0)
        self.held_atto = u256(int(self.held_atto) - amount)
        self.lifetime_outflow = u256(int(self.lifetime_outflow) + amount)
        if str(payout.kind) == PAYOUT_PROVIDER:
            self.total_released = u256(int(self.total_released) + amount)
            deal = self._require_deal(str(payout.deal_id))
            deal.paid_atto = u256(amount)
        elif str(payout.kind) == PAYOUT_CLIENT:
            self.total_refunded = u256(int(self.total_refunded) + amount)
        self._log({
            "event": "payout_delivered",
            "id": str(payout.deal_id),
            "kind": str(payout.kind),
            "to": str(payout.recipient),
            "amount_atto": str(amount),
        })

    def _return_payout(self, payout: Payout, returned: int, reason: str) -> None:
        """An attempt did not deliver; put the obligation back in play."""
        payout.state = PAYOUT_OWED
        payout.sent_at_unix = u64(0)
        payout.balance_at_emit = u256(0)
        payout.inflow_at_emit = u256(0)
        if returned > 0:
            payout.returned_atto = u256(int(payout.returned_atto) + returned)
        self._log({
            "event": "payout_returned",
            "id": str(payout.deal_id),
            "kind": str(payout.kind),
            "amount_atto": str(int(payout.amount_atto)),
            "returned_atto": str(returned),
            "reason": reason,
        })

    def _pump_payouts(self) -> None:
        """
        Reconcile a stale attempt and send the next owed payout.

        Permissionless. A stale `sent` payout is judged by the balance snapshot:
        delivered funds confirm, funds still here return to `owed`. Only one
        payout may be in flight at a time.
        """
        in_flight = self._in_flight_payout()
        if in_flight is not None:
            age = _now_unix() - int(in_flight.sent_at_unix)
            if age >= PAYOUT_GRACE_SEC:
                if self._delivered(in_flight):
                    self._confirm_payout_record(in_flight)
                else:
                    self._return_payout(in_flight, 0, "recovered_after_grace")
            if self._in_flight_payout() is not None:
                return
        for key in self.payout_queue:
            payout = self.payouts[key]
            if str(payout.state) == PAYOUT_OWED and int(payout.amount_atto) > 0:
                self._send_payout(payout)
                return

    @gl.public.write.payable
    def __on_errored_message__(self) -> None:
        """
        The platform returned a failed payout's value.

        The hook carries no deal id, which is why only one payout may be in
        flight. The value rejoins the obligation; delivery totals were never
        incremented, so no reversal is needed.
        """
        value = int(gl.message.value)
        self.total_returned = u256(int(self.total_returned) + value)
        payout = self._in_flight_payout()
        if payout is None:
            self._log({"event": "payout_refund_unmatched", "amount_atto": str(value)})
            return
        self._return_payout(payout, value, "platform_callback")
        self._log({
            "event": "payout_refunded",
            "id": str(payout.deal_id),
            "kind": str(payout.kind),
            "amount_atto": str(value),
        })

    def _settle_refund(self, deal: Deal, reason: str) -> None:
        amount = int(deal.escrow_atto)
        deal.settled = True
        deal.status = STATUS_REFUNDED
        deal.finalized_at_unix = u64(_now_unix())
        self._create_payout(str(deal.id), PAYOUT_CLIENT, deal.client, amount, "refund:" + str(deal.id))
        self._log({"event": "refunded", "id": str(deal.id), "reason": reason, "amount_atto": str(amount)})
        self._pump_payouts()

    # -------------------------------------------------------------- deal open

    @gl.public.write
    def open_deal(self, provider: str, terms_json: str) -> str:
        """
        Create an SLA deal from machine-readable terms. The client is the sender.

        The terms (endpoint, window, target, monitor) are fixed here and digested,
        so the service the validators will actually observe is known before any
        money moves.
        """
        client = gl.message.sender_address
        provider_address = _to_address(provider)
        if str(provider_address).lower() == str(client).lower():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} client and provider must differ")
        if _is_zero_address(provider_address):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} provider must not be the zero address")
        canonical, digest, meta = _parse_sla_terms(terms_json)

        deal_id = "s" + str(int(self.deal_count) + 1)
        self.deals[deal_id] = Deal(
            id=deal_id,
            client=client,
            provider=provider_address,
            service=meta["service"],
            endpoint=meta["endpoint"],
            terms_json=canonical,
            terms_digest=digest,
            window_seconds=u64(meta["window_seconds"]),
            slots=u64(meta["slots"]),
            slot_seconds=u64(meta["slot_seconds"]),
            uptime_target_bps=u256(meta["uptime_target_bps"]),
            min_coverage_bps=u256(meta["min_coverage_bps"]),
            expect_status=u64(meta["expect_status"]),
            monitor=meta["monitor"],
            attestation_url=meta["attestation_url"],
            escrow_atto=u256(0),
            status=STATUS_OPEN,
            created_at_unix=u64(_now_unix()),
            funded_at_unix=u64(0),
            started_at_unix=u64(0),
            end_unix=u64(0),
            probed_slots=u256(0),
            up_slots=u256(0),
            attested_digest="",
            attestation_nonce="",
            attested=False,
            attested_bps=u256(0),
            attestation_at_unix=u64(0),
            measured_bps=u256(0),
            uptime_bps=u256(0),
            release_bps=u256(0),
            outcome="",
            settled=False,
            finalized_at_unix=u64(0),
            paid_atto=u256(0),
            resolved_at_unix=u64(0),
            appeal_deadline_unix=u64(0),
            first_release_bps=u256(0),
            appellant=Address(ZERO_ADDRESS_HEX),
            appeal_bond_atto=u256(0),
            appeal_decided=False,
            final=False,
            appeal_evidence_unavailable=False,
        )
        self.deal_count = u256(int(self.deal_count) + 1)
        self.deal_order.append(deal_id)
        self._log({"event": "deal_opened", "id": deal_id, "service": meta["service"], "digest": digest})
        return deal_id

    @gl.public.write.payable
    def fund_deal(self, deal_id: str) -> None:
        """Client locks the escrow. The escrow amount is whatever is sent."""
        deal = self._require_deal(deal_id)
        if gl.message.sender_address != deal.client:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the client may fund this deal")
        if str(deal.status) != STATUS_OPEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not open")
        received = int(gl.message.value)
        if received < MIN_ESCROW_ATTO:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fund_deal() must be called with GEN value")
        deal.escrow_atto = u256(received)
        deal.funded_at_unix = u64(_now_unix())
        deal.status = STATUS_FUNDED
        self.held_atto = u256(int(self.held_atto) + received)
        self.lifetime_inflow = u256(int(self.lifetime_inflow) + received)
        self._log({"event": "deal_funded", "id": deal_id, "escrow_atto": str(received)})

    @gl.public.write
    def start_deal(self, deal_id: str) -> None:
        """Provider accepts the committed SLA, opening the monitoring window."""
        deal = self._require_deal(deal_id)
        if gl.message.sender_address != deal.provider:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the provider may start this deal")
        if str(deal.status) != STATUS_FUNDED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not funded")
        start = _now_unix()
        deal.started_at_unix = u64(start)
        deal.end_unix = u64(start + int(deal.window_seconds))
        deal.status = STATUS_ACTIVE
        self._log({"event": "deal_started", "id": deal_id, "end_unix": int(deal.end_unix)})

    @gl.public.write
    def cancel_deal(self, deal_id: str) -> None:
        """Client exits before the window opens, recovering the whole escrow."""
        deal = self._require_deal(deal_id)
        if gl.message.sender_address != deal.client:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the client may cancel")
        if str(deal.status) not in (STATUS_OPEN, STATUS_FUNDED):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} cannot be cancelled from {str(deal.status)}")
        self._settle_refund(deal, "client_cancelled")

    # ------------------------------------------------------------- monitoring

    @gl.public.write
    def probe_slot(self, deal_id: str, slot: int) -> None:
        """
        Permissionlessly record one slot's observed status.

        Validators independently fetch the committed endpoint and agree on UP/DOWN,
        so the submitter cannot fake the reading; and each slot accepts exactly one
        probe, so neither side can flood a bucket until it likes the answer.
        """
        deal = self._require_deal(deal_id)
        if not self._monitoring_open(deal):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not active")
        index = int(slot)
        if index < 0 or index >= int(deal.slots):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} slot must be between 0 and {int(deal.slots) - 1}")

        slots = self._stored_list(self.deal_slots, deal_id)
        if index < len(slots) and str(slots[index]) != "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} slot {index} has already been probed")

        slot_start = int(deal.started_at_unix) + index * int(deal.slot_seconds)
        slot_close = slot_start + int(deal.slot_seconds) + PROBE_GRACE_SEC
        now = _now_unix()
        if now < slot_start:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} slot {index} is not open yet")
        if now > slot_close:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} slot {index} has closed")

        result = self._derive_probe(deal)
        while len(slots) <= index:
            slots.append("")
        slots[index] = _canonical_json({"s": str(result["s"]), "http": int(result["http"])})
        self.deal_slots[deal_id] = slots

        deal.probed_slots = u256(int(deal.probed_slots) + 1)
        if str(result["s"]) == PROBE_UP:
            deal.up_slots = u256(int(deal.up_slots) + 1)
        self._log({"event": "slot_probed", "id": deal_id, "slot": index, "status": str(result["s"])})

    def _derive_probe(self, deal: Deal) -> dict:
        endpoint = str(deal.endpoint)
        expect_status = int(deal.expect_status)

        def leader_fn():
            return _probe_once(endpoint, expect_status)

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                # Compare the derived status only. The HTTP code and reachability
                # are audit data: a flaky edge can answer 503 to one node and 200 to
                # another without the two disagreeing on reachability intent.
                return str(theirs.get("s", "")) == str(mine.get("s", ""))

            return self._verify(leaders_res, leader_fn, compare)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # ------------------------------------------------------------- attestation

    @gl.public.write
    def commit_attestation(self, deal_id: str, digest: str, nonce: str) -> None:
        """
        Monitor commits the digest of its published report before settlement.

        Because the VM cannot verify a signature, the commitment is the binding:
        the report any validator later fetches must hash to exactly this digest,
        and its `deal_id`, `service`, `terms_digest`, `window_start_unix` and
        `window_end_unix` must match this deal. The monitor may re-commit a
        corrected digest while monitoring is open,
        including during an appeal window. A changed digest clears the old recorded
        reading, because it no longer describes the committed bytes.
        """
        deal = self._require_deal(deal_id)
        if not self._monitoring_open(deal):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not active")
        if _is_zero_address(deal.monitor):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has no monitor")
        if gl.message.sender_address != deal.monitor:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the deal monitor may commit an attestation")
        clean = str(digest).strip().lower()
        if len(clean) != 64:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} digest must be a 64-character hex sha256")
        for character in clean:
            if character not in "0123456789abcdef":
                raise gl.vm.UserError(f"{ERROR_EXPECTED} digest must be a 64-character hex sha256")
        previous = str(deal.attested_digest)
        if previous != "" and clean != previous and bool(deal.attested):
            # A re-commit changes the binding. The old recorded reading no longer
            # describes the committed bytes, so it must be refreshed before use.
            deal.attested = False
            deal.attested_bps = u256(0)
            deal.attestation_at_unix = u64(0)
            self._log({"event": "attestation_reopened", "id": deal_id, "digest": clean})
        deal.attested_digest = clean
        deal.attestation_nonce = _clip(str(nonce), NONCE_CLIP)
        self._log({"event": "attestation_committed", "id": deal_id, "digest": clean})

    @gl.public.write
    def submit_attestation(self, deal_id: str) -> None:
        """
        Fetch the committed report and record its uptime as the attested reading.

        Validators refetch and re-hash the report; a report whose bytes no longer
        match the commitment, or whose deal/service/terms/window fields describe a
        different agreement, is rejected rather than trusted. Admissible while the
        monitoring or appeal window is open, so a corrected report can be recorded.
        """
        deal = self._require_deal(deal_id)
        if not self._monitoring_open(deal):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not active")
        if str(deal.attested_digest) == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no attestation has been committed for {deal_id}")
        result = self._derive_attestation(deal)
        deal.attested_bps = u256(int(result["uptime_bps"]))
        deal.attested = True
        deal.attestation_at_unix = u64(_now_unix())
        self._log({"event": "attestation_recorded", "id": deal_id, "uptime_bps": int(result["uptime_bps"])})

    def _derive_attestation(self, deal: Deal) -> dict:
        url = str(deal.attestation_url)
        committed = str(deal.attested_digest)
        expected = {
            "deal_id": str(deal.id),
            "service": str(deal.service),
            "terms_digest": str(deal.terms_digest).strip().lower(),
            "window_start_unix": int(deal.started_at_unix),
            "window_end_unix": int(deal.end_unix),
        }

        def leader_fn():
            return _attestation_once(url, committed, expected)

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                return int(theirs.get("uptime_bps", -1)) == int(mine.get("uptime_bps", -2))

            return self._verify(leaders_res, leader_fn, compare)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # -------------------------------------------------------------- settlement

    def _coverage_bps(self, deal: Deal) -> int:
        total_slots = int(deal.slots)
        if total_slots == 0:
            return 0
        return 10000 * int(deal.probed_slots) // total_slots

    def _probe_coverage_authoritative(self, deal: Deal) -> bool:
        """Probes decide only when they cover at least the committed floor.

        This is the fix for the thin-coverage hole: one probe out of 720 used to
        be enough to decide a whole SLA. A floor of zero still requires at least
        one probe, because no probe is no evidence.
        """
        return int(deal.probed_slots) > 0 and self._coverage_bps(deal) >= int(deal.min_coverage_bps)

    def _compute_verdict(self, deal: Deal, refresh_attestation: bool):
        """
        The deterministic verdict for a deal, from the recorded evidence.

        Uptime comes from the decentralized slot probes only when their coverage
        reaches `min_coverage_bps`; otherwise the monitor's attested report is
        used. If neither is available, settlement refuses rather than letting a
        token sample decide. The verdict is a pure function of the recorded
        evidence and the committed terms. Only the attested reading can be
        re-fetched live (`refresh_attestation`), which is what an appeal is for:
        the monitor may publish a corrected report and re-commit its digest
        during the appeal window.
        """
        probed = int(deal.probed_slots)
        attested = bool(deal.attested)
        if self._probe_coverage_authoritative(deal):
            uptime = 10000 * int(deal.up_slots) // probed
            source = "probes"
        elif refresh_attestation and str(deal.attested_digest) != "":
            fresh = self._derive_attestation(deal)
            uptime = int(fresh["uptime_bps"])
            deal.attested = True
            deal.attested_bps = u256(uptime)
            deal.attestation_at_unix = u64(_now_unix())
            source = "attestation_refresh"
        elif attested:
            uptime = int(deal.attested_bps)
            source = "attestation"
        elif probed > 0:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} probe coverage is below the committed floor and no attestation is recorded; "
                "use claim_lapsed after the lapse grace"
            )
        else:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no monitoring evidence for {deal.id}; use claim_lapsed")

        target = int(deal.uptime_target_bps)
        if uptime >= target:
            outcome = OUTCOME_MET
            release_bps = 10000
        else:
            outcome = OUTCOME_BREACHED
            release_bps = 10000 * uptime // target
        return uptime, outcome, release_bps, source

    def _tentative_verdict(self, deal: Deal):
        """The standing verdict written by `settle`, used when fresh evidence is unavailable."""
        return (
            int(deal.uptime_bps),
            str(deal.outcome),
            int(deal.release_bps),
            "tentative_fallback",
        )

    @gl.public.write
    def settle(self, deal_id: str) -> None:
        """
        Permissionlessly open the appeal window with a tentative verdict.

        Everything is deterministic from the recorded evidence, so the split is
        exact and no model is involved. No money moves here: a party may contest
        the verdict for `APPEAL_WINDOW_SEC`, after which `finalize` pays it out.
        """
        deal = self._require_deal(deal_id)
        if str(deal.status) != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not active")
        if _now_unix() < int(deal.end_unix):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} the monitoring window for {deal_id} is still open")

        uptime, outcome, release_bps, source = self._compute_verdict(deal, refresh_attestation=False)
        deal.measured_bps = u256(uptime)
        deal.uptime_bps = u256(uptime)
        deal.release_bps = u256(release_bps)
        deal.first_release_bps = u256(release_bps)
        deal.outcome = outcome
        deal.resolved_at_unix = u64(_now_unix())
        deal.appeal_deadline_unix = u64(_now_unix() + APPEAL_WINDOW_SEC)
        deal.final = False
        deal.status = STATUS_RESOLVED
        self._log({
            "event": "settled",
            "id": deal_id,
            "outcome": outcome,
            "uptime_bps": uptime,
            "release_bps": release_bps,
            "source": source,
        })

    @gl.public.write.payable
    def appeal(self, deal_id: str) -> None:
        """
        Contest a tentative verdict by staking a bond.

        The loser of the appeal forfeits the bond to the other party, so an appeal
        is only worth filing when the appellant believes the verdict is actually
        wrong. The bond joins `held_atto` until `finalize` distributes it.
        """
        deal = self._require_deal(deal_id)
        sender = gl.message.sender_address
        if sender != deal.client and sender != deal.provider:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only a party to the deal may appeal")
        if str(deal.status) != STATUS_RESOLVED or bool(deal.final):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has no appealable verdict")
        if _now_unix() > int(deal.appeal_deadline_unix):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} the appeal window for {deal_id} has closed")
        received = int(gl.message.value)
        required = self._required_appeal_bond(deal)
        if received < required:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} appeal bond must be at least {required} atto")
        deal.appellant = sender
        deal.appeal_bond_atto = u256(received)
        deal.status = STATUS_APPEALED
        self.held_atto = u256(int(self.held_atto) + received)
        self.lifetime_inflow = u256(int(self.lifetime_inflow) + received)
        self._log({"event": "appealed", "id": deal_id, "by": str(sender), "bond_atto": str(received)})

    @gl.public.write
    def resolve_appeal(self, deal_id: str) -> None:
        """
        Re-derive an appealed verdict from the freshest evidence.

        Late probes filed during the window and the monitor's re-published,
        re-committed report are folded in, so an appeal is a genuine second look
        rather than a re-run of the same numbers. The second verdict is final.

        Resolution cannot run before the appeal deadline, even though this method
        is permissionless. Otherwise an appellant could file and immediately
        resolve, locking the verdict before the remaining evidence window closes.
        The observation writes are closed at the same deadline by
        `_monitoring_open`, so appealed and unappealed paths share one cutoff.

        If the source is unreachable and the recorded evidence cannot be refreshed,
        the tentative verdict stands and the bond is returned to the appellant. That
        keeps an infrastructure outage from parking the deal in APPEALED forever.
        """
        deal = self._require_deal(deal_id)
        if str(deal.status) != STATUS_APPEALED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has no pending appeal")
        if _now_unix() <= int(deal.appeal_deadline_unix):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} the appeal window for {deal_id} is still open")

        try:
            uptime, outcome, release_bps, source = self._compute_verdict(
                deal, refresh_attestation=True
            )
            deal.appeal_evidence_unavailable = False
        except gl.vm.UserError:
            # A monitor can be down, or a re-committed report may not be published
            # yet. Keeping the tentative verdict (and returning the bond) makes the
            # appeal actionable instead of parking the deal in APPEALED forever.
            uptime, outcome, release_bps, source = self._tentative_verdict(deal)
            deal.appeal_evidence_unavailable = True

        deal.measured_bps = u256(uptime)
        deal.uptime_bps = u256(uptime)
        deal.release_bps = u256(release_bps)
        deal.outcome = outcome
        deal.appeal_decided = True
        deal.final = True
        deal.status = STATUS_RESOLVED
        self._log({
            "event": "appeal_resolved",
            "id": deal_id,
            "outcome": outcome,
            "uptime_bps": uptime,
            "release_bps": release_bps,
            "source": source,
            "evidence_unavailable": bool(deal.appeal_evidence_unavailable),
        })

    @gl.public.write
    def finalize(self, deal_id: str) -> None:
        """
        Pay out the standing verdict and settle any appeal bond.

        Permissionless, but always after the appeal deadline. An unappealed verdict
        is recomputed here so late probes and a correctly re-committed report are
        honoured; if fresh evidence is unavailable, the tentative verdict stands
        rather than blocking finalization. A decided appeal is authoritative and is
        not recomputed. The deadline check does not depend on `final`, so an early
        appeal resolution can never shorten the evidence window.
        """
        deal = self._require_deal(deal_id)
        if str(deal.status) != STATUS_RESOLVED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has no standing verdict")
        if _now_unix() <= int(deal.appeal_deadline_unix):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} the appeal window for {deal_id} is still open")
        if not bool(deal.final):
            refresh = str(deal.attested_digest) != "" and not bool(deal.attested)
            try:
                uptime, outcome, release_bps, source = self._compute_verdict(
                    deal, refresh_attestation=refresh
                )
            except gl.vm.UserError:
                uptime, outcome, release_bps, source = self._tentative_verdict(deal)
                self._log({
                    "event": "finalize_evidence_fallback",
                    "id": deal_id,
                    "source": source,
                })
            deal.measured_bps = u256(uptime)
            deal.uptime_bps = u256(uptime)
            deal.release_bps = u256(release_bps)
            deal.outcome = outcome

        release_bps = int(deal.release_bps)
        escrow = int(deal.escrow_atto)
        provider_cut = escrow * release_bps // 10000
        client_cut = escrow - provider_cut
        deal.settled = True
        deal.status = STATUS_FINALIZED
        deal.finalized_at_unix = u64(_now_unix())
        self._create_payout(deal_id, PAYOUT_PROVIDER, deal.provider, provider_cut, "release:" + deal_id)
        self._create_payout(deal_id, PAYOUT_CLIENT, deal.client, client_cut, "refund:" + deal_id)
        self._settle_appeal_bond(deal)
        self._log({
            "event": "finalized",
            "id": deal_id,
            "outcome": str(deal.outcome),
            "release_bps": release_bps,
            "provider_atto": str(provider_cut),
            "client_atto": str(client_cut),
        })
        self._pump_payouts()

    def _required_appeal_bond(self, deal: Deal) -> int:
        share = int(deal.escrow_atto) * APPEAL_BOND_BPS // 10000
        return max(share, MIN_APPEAL_BOND_ATTO)

    def _appellant_won(self, deal: Deal) -> bool:
        first = int(deal.first_release_bps)
        final = int(deal.release_bps)
        if str(deal.appellant) == str(deal.client):
            # The client benefits when the provider's share falls.
            return final < first
        # The provider benefits when its share rises.
        return final > first

    def _settle_appeal_bond(self, deal: Deal) -> None:
        bond = int(deal.appeal_bond_atto)
        if bond <= 0:
            return
        appellant = deal.appellant
        counterparty = deal.provider if str(appellant) == str(deal.client) else deal.client
        if self._appellant_won(deal) or bool(deal.appeal_evidence_unavailable):
            memo = "appeal_returned_no_evidence:" if bool(deal.appeal_evidence_unavailable) else "appeal_returned:"
            self._create_payout(str(deal.id), PAYOUT_BOND, appellant, bond, memo + str(deal.id))
        else:
            self._create_payout(str(deal.id), PAYOUT_BOND, counterparty, bond, "appeal_forfeited:" + str(deal.id))

    @gl.public.write
    def claim_lapsed(self, deal_id: str) -> None:
        """
        Permissionless liveness backstop so funds can never be stuck.

        A deal whose window closed without authoritative evidence refunds the
        client after a grace long enough for a slow monitor to file. That includes
        thin probe coverage: without an attestation, a token sample cannot decide
        the SLA, and refusing to settle must still leave the client a way out.
        """
        deal = self._require_deal(deal_id)
        if str(deal.status) != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} is not active")
        if bool(deal.attested):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has an attestation; settle instead")
        if self._probe_coverage_authoritative(deal):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deal {deal_id} has enough probe coverage; settle instead")
        if _now_unix() <= int(deal.end_unix) + LAPSE_GRACE_SEC:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} the monitoring window for {deal_id} has not lapsed")
        reason = "inconclusive_coverage" if int(deal.probed_slots) > 0 else "lapsed"
        self._settle_refund(deal, reason)

    # ---------------------------------------------------------------- payouts

    @gl.public.write
    def pump_payouts(self) -> None:
        """Permissionless: reconcile a stale attempt and send the next owed payout."""
        self._pump_payouts()

    @gl.public.write
    def retry_payout(self, deal_id: str, kind: str) -> None:
        """Beneficiary-only resend of an owed payout. Never moves delivery totals."""
        payout = self._require_payout(deal_id, kind)
        if gl.message.sender_address != payout.recipient:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the payout beneficiary may retry")
        if str(payout.state) != PAYOUT_OWED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} is not awaiting a retry")
        if self._in_flight_payout() is not None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} another payout is still in flight")
        self._send_payout(payout)

    @gl.public.write
    def recover_payout(self, deal_id: str, kind: str) -> None:
        """
        Return an undelivered payout to `owed` after the grace period.

        The grace separates "still in flight" from "failed but the callback was
        lost"; resending before it could pay the beneficiary twice.
        """
        payout = self._require_payout(deal_id, kind)
        if str(payout.state) == PAYOUT_DELIVERED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} was delivered; confirm_payout instead")
        if str(payout.state) != PAYOUT_SENT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} has no attempt to recover")
        age = _now_unix() - int(payout.sent_at_unix)
        if age < PAYOUT_GRACE_SEC:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} is still inside its grace period")
        if self._delivered(payout):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} was delivered; confirm_payout instead")
        self._return_payout(payout, 0, "recovered")

    @gl.public.write
    def confirm_payout(self, deal_id: str, kind: str) -> None:
        """Permissionless: book a delivered payout once the balance proves it left."""
        payout = self._require_payout(deal_id, kind)
        if str(payout.state) == PAYOUT_DELIVERED:
            return
        if str(payout.state) != PAYOUT_SENT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} has no attempt to confirm")
        if not self._delivered(payout):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {deal_id}:{kind} is not observably delivered yet")
        self._confirm_payout_record(payout)
        self._pump_payouts()

    # ------------------------------------------------------------- reasoning

    def _equivalence_note(self) -> dict:
        """The static rule validators applied, published so a UI can explain it."""
        return {
            "principle": "Optimistic Democracy, equivalence check",
            "probe": "derived UP/DOWN compared exactly",
            "attestation": "report re-hashed against the committed digest and bound to the deal/service/terms/window, then uptime_bps compared exactly",
            "release_bps": "computed deterministically from measured uptime; no model involved",
            "appeal": "a tentative verdict is paid only at finalize; a bonded appeal re-derives it (late probes + refreshed attestation), and an unavailable source keeps the tentative verdict and returns the bond",
            "coverage": "probes are authoritative only when coverage reaches min_coverage_bps; otherwise attestation, else inconclusive refund after the lapse grace",
            "payout": "a decided payout is delivered only when the balance snapshot proves the value left; a failed child returns to owed and can be retried",
            "audit_only_fields": ["http", "reachable", "nonce", "digest"],
        }

    # ---------------------------------------------------------------- helpers

    def _require_deal(self, deal_id: str) -> Deal:
        if deal_id not in self.deals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown deal {deal_id}")
        return self.deals[deal_id]

    def _require_payout(self, deal_id: str, kind: str) -> Payout:
        key = self._payout_key(deal_id, kind)
        if key not in self.payouts:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown payout {key}")
        return self.payouts[key]

    def _monitoring_open(self, deal: Deal) -> bool:
        """
        Whether monitoring writes (probes, attestation commits) are admissible.

        True while the SLA window is ACTIVE, and again during an open appeal
        window so a contest can introduce late probes and a corrected
        attestation. The per-slot timing check still bounds which probes land.
        Once the appeal deadline passes, appealed and unappealed verdicts are
        both closed to new evidence.
        """
        status = str(deal.status)
        if status == STATUS_ACTIVE:
            return True
        if status == STATUS_APPEALED:
            return _now_unix() <= int(deal.appeal_deadline_unix)
        if status == STATUS_RESOLVED and not bool(deal.final):
            return _now_unix() <= int(deal.appeal_deadline_unix)
        return False

    def _stored_list(self, store, deal_id: str) -> list:
        """Read a TreeMap[str, DynArray[str]] slot, or [] when it was never set."""
        if deal_id not in store:
            return []
        return [str(item) for item in store[deal_id]]

    def _handle_leader_error(self, leaders_res, leader_fn) -> bool:
        leader_message = ""
        if hasattr(leaders_res, "message"):
            leader_message = str(leaders_res.message)
        try:
            leader_fn()
            return False
        except gl.vm.UserError as failure:
            validator_message = str(failure.message) if hasattr(failure, "message") else str(failure)
            if validator_message.startswith(ERROR_EXPECTED) or validator_message.startswith(ERROR_EXTERNAL):
                return validator_message == leader_message
            if validator_message.startswith(ERROR_TRANSIENT) and leader_message.startswith(ERROR_TRANSIENT):
                return True
            return False
        except Exception:
            return False

    def _verify(self, leaders_res, leader_fn, compare) -> bool:
        if not isinstance(leaders_res, gl.vm.Return):
            return self._handle_leader_error(leaders_res, leader_fn)
        try:
            mine = leader_fn()
        except Exception:
            return False
        return bool(compare(leaders_res.calldata, mine))

    def _log(self, entry: dict) -> None:
        if len(self.event_log) >= MAX_LOG:
            self.log_truncated = True
            return
        self.event_log.append(_clip(_canonical_json(entry), ENTRY_CLIP))

    # ------------------------------------------------------------------ views

    @gl.public.view
    def get_deal(self, deal_id: str) -> str:
        deal = self._require_deal(deal_id)
        return _canonical_json({
            "id": str(deal.id),
            "client": str(deal.client),
            "provider": str(deal.provider),
            "service": str(deal.service),
            "endpoint": str(deal.endpoint),
            "terms_digest": str(deal.terms_digest),
            "window_seconds": int(deal.window_seconds),
            "slots": int(deal.slots),
            "slot_seconds": int(deal.slot_seconds),
            "uptime_target_bps": int(deal.uptime_target_bps),
            "min_coverage_bps": int(deal.min_coverage_bps),
            "monitor": str(deal.monitor),
            "attestation_url": str(deal.attestation_url),
            "escrow_atto": str(int(deal.escrow_atto)),
            "status": str(deal.status),
            "started_at_unix": int(deal.started_at_unix),
            "end_unix": int(deal.end_unix),
            "probed_slots": int(deal.probed_slots),
            "up_slots": int(deal.up_slots),
            "attested": bool(deal.attested),
            "attested_bps": int(deal.attested_bps),
            "uptime_bps": int(deal.uptime_bps),
            "release_bps": int(deal.release_bps),
            "first_release_bps": int(deal.first_release_bps),
            "outcome": str(deal.outcome),
            "settled": bool(deal.settled),
            "paid_atto": str(int(deal.paid_atto)),
            "resolved_at_unix": int(deal.resolved_at_unix),
            "appeal_deadline_unix": int(deal.appeal_deadline_unix),
            "appellant": str(deal.appellant),
            "appeal_bond_atto": str(int(deal.appeal_bond_atto)),
            "appeal_decided": bool(deal.appeal_decided),
            "appeal_evidence_unavailable": bool(deal.appeal_evidence_unavailable),
            "final": bool(deal.final),
        })

    @gl.public.view
    def get_terms(self, deal_id: str) -> str:
        deal = self._require_deal(deal_id)
        return str(deal.terms_json)

    @gl.public.view
    def get_monitor_log(self, deal_id: str) -> str:
        """One entry per probed slot, or null for a slot nobody observed."""
        deal = self._require_deal(deal_id)
        slots = self._stored_list(self.deal_slots, deal_id)
        records = []
        index = 0
        while index < int(deal.slots):
            raw = slots[index] if index < len(slots) else ""
            if raw == "":
                records.append(None)
            else:
                try:
                    records.append(json.loads(raw))
                except Exception:
                    records.append(None)
            index += 1
        return _canonical_json(records)

    @gl.public.view
    def get_deal_audit(self, deal_id: str) -> str:
        deal = self._require_deal(deal_id)
        return _canonical_json({
            "id": str(deal.id),
            "status": str(deal.status),
            "outcome": str(deal.outcome),
            "uptime_bps": int(deal.uptime_bps),
            "measured_bps": int(deal.measured_bps),
            "release_bps": int(deal.release_bps),
            "probed_slots": int(deal.probed_slots),
            "up_slots": int(deal.up_slots),
            "attested": bool(deal.attested),
            "attested_bps": int(deal.attested_bps),
            "attested_digest": str(deal.attested_digest),
            "attestation_nonce": str(deal.attestation_nonce),
            "monitor": str(deal.monitor),
            "paid_atto": str(int(deal.paid_atto)),
            "first_release_bps": int(deal.first_release_bps),
            "resolved_at_unix": int(deal.resolved_at_unix),
            "appellant": str(deal.appellant),
            "appeal_bond_atto": str(int(deal.appeal_bond_atto)),
            "appeal_decided": bool(deal.appeal_decided),
            "appeal_evidence_unavailable": bool(deal.appeal_evidence_unavailable),
            "final": bool(deal.final),
        })

    def _payout_row(self, payout: Payout) -> dict:
        return {
            "deal_id": str(payout.deal_id),
            "kind": str(payout.kind),
            "recipient": str(payout.recipient),
            "amount_atto": str(int(payout.amount_atto)),
            "memo": str(payout.memo),
            "state": str(payout.state),
            "attempts": int(payout.attempts),
            "sent_at_unix": int(payout.sent_at_unix),
            "balance_at_emit": str(int(payout.balance_at_emit)),
            "inflow_at_emit": str(int(payout.inflow_at_emit)),
            "returned_atto": str(int(payout.returned_atto)),
            "delivered_at_unix": int(payout.delivered_at_unix),
        }

    @gl.public.view
    def get_payouts(self, deal_id: str) -> str:
        """Payout delivery rows for one deal, plus the reconciliation context."""
        self._require_deal(deal_id)
        rows = []
        for key in self.payout_queue:
            payout = self.payouts[key]
            if str(payout.deal_id) == str(deal_id):
                rows.append(self._payout_row(payout))
        in_flight = self._in_flight_payout()
        return _canonical_json({
            "payouts": rows,
            "contract_balance_atto": str(int(self.balance)),
            "grace_seconds": PAYOUT_GRACE_SEC,
            "in_flight": str(in_flight.deal_id) + ":" + str(in_flight.kind) if in_flight is not None else "",
            "total_returned_atto": str(int(self.total_returned)),
        })

    @gl.public.view
    def get_pending_payouts(self) -> str:
        """Every obligation not yet observed delivered. Permissionless keeper feed."""
        rows = []
        for key in self.payout_queue:
            payout = self.payouts[key]
            if str(payout.state) != PAYOUT_DELIVERED:
                rows.append(self._payout_row(payout))
        return _canonical_json(rows)

    @gl.public.view
    def get_deal_ids(self) -> str:
        return _canonical_json([str(item) for item in self.deal_order])

    @gl.public.view
    def get_deal_count(self) -> int:
        return int(self.deal_count)

    @gl.public.view
    def get_config(self) -> str:
        return _canonical_json({
            "max_slots": MAX_SLOTS,
            "probe_grace_sec": PROBE_GRACE_SEC,
            "lapse_grace_sec": LAPSE_GRACE_SEC,
            "default_min_coverage_bps": DEFAULT_MIN_COVERAGE_BPS,
            "min_escrow_atto": MIN_ESCROW_ATTO,
            "appeal_window_sec": APPEAL_WINDOW_SEC,
            "appeal_bond_bps": APPEAL_BOND_BPS,
            "min_appeal_bond_atto": MIN_APPEAL_BOND_ATTO,
            "payout_grace_sec": PAYOUT_GRACE_SEC,
            "equivalence": self._equivalence_note(),
        })

    @gl.public.view
    def get_stats(self) -> str:
        owed_atto = 0
        in_flight_atto = 0
        pending = 0
        unreconciled = 0
        for key in self.payout_queue:
            payout = self.payouts[key]
            state = str(payout.state)
            amount = int(payout.amount_atto)
            if state == PAYOUT_OWED:
                owed_atto += amount
                pending += 1
            elif state == PAYOUT_SENT:
                in_flight_atto += amount
                pending += 1
                unreconciled += 1
        return _canonical_json({
            "deals": int(self.deal_count),
            "held_atto": str(int(self.held_atto)),
            "lifetime_inflow_atto": str(int(self.lifetime_inflow)),
            "lifetime_outflow_atto": str(int(self.lifetime_outflow)),
            "total_released_atto": str(int(self.total_released)),
            "total_refunded_atto": str(int(self.total_refunded)),
            "owed_atto": str(owed_atto),
            "in_flight_atto": str(in_flight_atto),
            "pending_payouts": pending,
            "unreconciled_payouts": unreconciled,
            "total_returned_atto": str(int(self.total_returned)),
            "conserved": int(self.held_atto) == int(self.lifetime_inflow) - int(self.lifetime_outflow),
            "log_truncated": bool(self.log_truncated),
        })

    @gl.public.view
    def get_log(self, start: int, count: int) -> str:
        entries = []
        index = max(0, int(start))
        stop = min(len(self.event_log), index + max(0, int(count)))
        while index < stop:
            entries.append(str(self.event_log[index]))
            index += 1
        return _canonical_json(entries)
