"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  Coins,
  FileJson2,
  Gavel,
  Radio,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SlotLegend, SlotStrip } from "@/components/ui/slot-strip";
import { StatusBadge } from "@/components/deal/status-badge";
import { ConfigNotice } from "@/components/config-notice";
import { useWallet } from "@/components/wallet/wallet-context";
import { useTx } from "@/hooks/use-tx";
import { useNow } from "@/hooks/use-now";
import {
  useAudit,
  useDeal,
  useLog,
  useMonitorLog,
  usePayouts,
  useTerms,
} from "@/hooks/use-contract";
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  PROTOCOL,
  STATUS_NOTE,
  appealBondFor,
  canonicalDigest,
  claimLapsed,
  commitAttestation,
  confirmPayout,
  coverageBps,
  evidenceSource,
  finalize,
  fundDeal,
  hasEvidence,
  isLapsed,
  isConfigured,
  nextProbeSlot,
  probeCoverageAuthoritative,
  probeUptimeBps,
  probeSlot,
  pumpPayouts,
  recoverPayout,
  resolveAppeal,
  retryPayout,
  roleOf,
  roleOfLabel,
  settle,
  startDeal,
  submitAttestation,
  cancelDeal,
  appeal as fileAppealTx,
  type Deal,
  type DealAudit,
  type LogEntry,
  type PayoutInfo,
  type WriteResult,
} from "@/lib/observa";
import {
  bpsToPercent,
  countdown,
  formatDuration,
  formatGen,
  formatUnix,
  gen as parseGen,
  relativeTime,
  sameAddress,
  shortAddress,
  shortDigest,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<"probes" | "attestation" | "inconclusive" | "none", string> = {
  probes: "decentralized probes",
  attestation: "monitor attestation",
  inconclusive: "coverage below floor",
  none: "no evidence",
};

const DEAL_POLL_MS = 30_000;
const SUPPORT_POLL_MS = 120_000;
const PAYOUT_POLL_MS = 60_000;

export function DealView() {
  const params = useParams();
  const id = String(params.id ?? "");
  const now = useNow();
  const { address } = useWallet();
  const dealState = useDeal(id, DEAL_POLL_MS);
  const termsState = useTerms(id);
  const logState = useMonitorLog(id);
  const auditState = useAudit(id, SUPPORT_POLL_MS);
  const payoutState = usePayouts(id, PAYOUT_POLL_MS);
  const events = useLog(id);

  const refreshDeal = dealState.refresh;
  const refreshTerms = termsState.refresh;
  const refreshLog = logState.refresh;
  const refreshAudit = auditState.refresh;
  const refreshPayouts = payoutState.refresh;
  const refreshEvents = events.refresh;

  const refreshAll = React.useCallback(() => {
    refreshDeal();
    refreshTerms();
    refreshLog();
    refreshAudit();
    refreshPayouts();
    refreshEvents();
  }, [
    refreshDeal,
    refreshTerms,
    refreshLog,
    refreshAudit,
    refreshPayouts,
    refreshEvents,
  ]);

  if (!dealState.data && dealState.error) {
    if (!isConfigured) {
      return (
        <div className="mx-auto max-w-[1360px] px-5 py-16">
          <p className="eyebrow text-muted">Deal / {id}</p>
          <h1 className="mt-5 max-w-2xl font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] text-veil">
            This record needs a contract.
          </h1>
          <ConfigNotice className="mt-8 max-w-2xl" />
          <p className="mt-4 max-w-xl text-[0.84rem] leading-relaxed text-mist-dim">
            The deal record cannot be read until the contract address is set.
          </p>
          <div className="mt-7 flex gap-2">
            <Link href="/open">
              <Button variant="secondary" size="sm">
                Back to open
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm">
                Home
              </Button>
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-[1360px] px-5 py-16">
        <p className="eyebrow text-muted">Deal / {id}</p>
        <div className="mt-6 max-w-2xl border-l-2 border-loss bg-loss/[0.05] px-4 py-4">
          <p className="flex items-center gap-2 font-display text-[1.5rem] text-loss">
            <AlertTriangle className="size-5" /> The record did not load
          </p>
          <p className="mt-2 text-[0.82rem] text-mist-dim">{dealState.error}</p>
          <p className="mt-2 text-[0.74rem] text-muted">
            If the deal was just opened, the transaction may still be reaching
            finality. Refresh in a few seconds.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={dealState.refresh}>
              <RefreshCw /> Try again
            </Button>
            <Link href="/market">
              <Button variant="ghost" size="sm">
                Back to the ledger
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!dealState.data) {
    return (
      <div className="mx-auto max-w-[1360px] px-5 py-10">
        <div className="h-3 w-40 animate-pulse bg-panel-3" />
        <div className="mt-7 h-10 w-80 animate-pulse bg-panel-3" />
        <div className="mt-8 grid gap-5 lg:grid-cols-[1.5fr_0.72fr]">
          <div className="space-y-5">
            <div className="h-64 animate-pulse border border-line-soft bg-panel/50" />
            <div className="h-52 animate-pulse border border-line-soft bg-panel/50" />
          </div>
          <div className="h-96 animate-pulse border border-line-soft bg-panel/50" />
        </div>
      </div>
    );
  }

  const deal = dealState.data;
  const log = logState.data ?? [];
  const audit = auditState.data;
  const terms = termsState.data;
  const payoutInfo = payoutState.data;
  const role = roleOf(deal, address);
  const nextSlot = nextProbeSlot(deal, log, now);
  const coverage = coverageBps(deal);
  const probeUptime = probeUptimeBps(deal);
  const source = evidenceSource(deal);
  const windowOpen = deal.status === "ACTIVE";
  const hasVerdict =
    ["RESOLVED", "APPEALED", "FINALIZED"].includes(deal.status) && deal.outcome !== "";
  const displayedUptime = hasVerdict ? deal.uptime_bps : probeUptime;

  return (
    <div className="mx-auto max-w-[1360px] px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted">
          <Link href="/market" className="transition-colors hover:text-signal">
            Ledger
          </Link>{" "}
          / <span className="text-mist-dim">{deal.id}</span>
        </p>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted transition-colors hover:text-signal"
        >
          <RefreshCw className="size-3" /> refresh
        </button>
      </div>

      <header className="mt-7 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusBadge status={deal.status} />
            {hasVerdict && deal.outcome ? (
              <Badge tone={OUTCOME_TONE[deal.outcome] ?? "neutral"}>{deal.outcome}</Badge>
            ) : null}
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
              {deal.id}
            </span>
          </div>
          <h1 className="mt-4 font-display text-[clamp(2.5rem,5vw,4.3rem)] leading-[0.94] text-veil">
            {deal.service}
          </h1>
          <a
            href={deal.endpoint}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[0.68rem] text-muted transition-colors hover:text-signal"
          >
            <span className="truncate">{deal.endpoint}</span>
            <ArrowUpRight className="size-3 shrink-0" />
          </a>
          <p className="mt-5 max-w-2xl text-[0.86rem] leading-relaxed text-mist-dim text-veil">
            {STATUS_NOTE[deal.status] ?? ""}
          </p>
        </div>

        <div className="flex items-end gap-6 lg:gap-8">
          <div>
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-muted">
              your role
            </p>
            <p className="mt-1.5 font-display text-[1.6rem] leading-none">
              {roleOfLabel(role)}
            </p>
          </div>
          <div className="border-l border-line pl-6 lg:pl-8">
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-muted">
              {windowOpen ? "window closes" : "window"}
            </p>
            <p className="mt-1.5 font-display text-[1.6rem] leading-none tabular">
              {windowOpen ? countdown(deal.end_unix, now) : formatDuration(deal.window_seconds)}
            </p>
          </div>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-px border-y border-line bg-line-soft md:grid-cols-4">
        <Summary label="coverage" value={bpsToPercent(coverage)} note={`floor ${bpsToPercent(deal.min_coverage_bps)}`} />
        <Summary
          label="uptime"
          value={bpsToPercent(displayedUptime)}
          note={`target ${bpsToPercent(deal.uptime_target_bps)}`}
          tone={
            hasVerdict || deal.probed_slots > 0
              ? displayedUptime >= deal.uptime_target_bps
                ? "signal"
                : "loss"
              : undefined
          }
        />
        <Summary label="escrow" value={`${formatGen(deal.escrow_atto)} GEN`} note={deal.settled ? "settled" : "held"} />
        <Summary
          label="evidence"
          value={SOURCE_LABEL[source]}
          note={
            deal.attested
              ? `attested ${bpsToPercent(deal.attested_bps)}`
              : source === "inconclusive"
                ? `${deal.probed_slots} probes · floor ${bpsToPercent(deal.min_coverage_bps)}`
                : `${deal.probed_slots} probes`
          }
        />
      </div>

      <ConfigNotice className="mt-6 max-w-2xl" />

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_0.72fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Radio className="size-4 text-signal" /> Observation
                  </CardTitle>
                  <CardDescription>
                    One sample per slot. Validators independently agree on UP/DOWN;
                    unobserved slots stay empty.
                  </CardDescription>
                </div>
                <Badge tone={nextSlot !== null ? "signal" : "neutral"}>
                  {nextSlot !== null ? `slot ${nextSlot} open` : deal.status === "ACTIVE" ? "between slots" : "closed"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {logState.error ? (
                <div className="mb-3 border-l-2 border-loss bg-loss/[0.05] px-3 py-2 text-xs text-loss">
                  {logState.error}
                </div>
              ) : null}

              <div className="border-y border-line-soft bg-void/35 px-3 py-4">
                <SlotStrip log={log} slots={deal.slots} highlight={nextSlot} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <SlotLegend />
                <span className="font-mono text-[0.6rem] text-muted">
                  cadence {formatDuration(deal.slot_seconds)} · grace {PROTOCOL.probeGraceSec}s
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-px border border-line-soft bg-line-soft sm:grid-cols-4">
                <Stat label="observed" value={`${deal.probed_slots}/${deal.slots}`} />
                <Stat label="up" value={String(deal.up_slots)} tone="signal" />
                <Stat
                  label="down"
                  value={String(Math.max(0, deal.probed_slots - deal.up_slots))}
                  tone={deal.probed_slots > deal.up_slots ? "loss" : undefined}
                />
                <Stat label="coverage" value={bpsToPercent(coverage)} />
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <Meter
                  label="coverage"
                  value={coverage}
                  target={deal.min_coverage_bps}
                  tone="signal"
                  targetLabel="floor"
                />
                <Meter
                  label="observed uptime"
                  value={probeUptime}
                  target={deal.uptime_target_bps}
                  tone={probeUptime >= deal.uptime_target_bps ? "signal" : "loss"}
                  targetLabel="target"
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-l border-line pl-3.5 text-[0.72rem]">
                <span className="text-muted">
                  evidence path{" "}
                  <span className="font-mono text-mist-dim">{SOURCE_LABEL[source]}</span>
                </span>
                {deal.attested ? (
                  <span className="font-mono text-mist-dim">
                    attested {bpsToPercent(deal.attested_bps)}
                  </span>
                ) : (
                  <span className="font-mono text-muted">no attestation recorded</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Gavel className="size-4 text-watch" /> Verdict
                  </CardTitle>
                  <CardDescription>
                    {hasVerdict
                      ? "Deterministic split from the recorded evidence. No model, no discretion."
                      : "A verdict appears once someone calls settle after the window closes."}
                  </CardDescription>
                </div>
                {deal.status === "APPEALED" ? <Badge tone="loss">contested</Badge> : null}
              </div>
            </CardHeader>
            <CardContent>
              {hasVerdict ? (
                <VerdictBody deal={deal} audit={audit} now={now} />
              ) : (
                <div className="border-l border-line pl-4 py-4">
                  <p className="font-display text-[1.8rem] leading-none">
                    {deal.status === "ACTIVE" ? "The window is still open." : "No verdict yet."}
                  </p>
                  <p className="mt-2 text-[0.82rem] text-muted">
                    {deal.status === "ACTIVE"
                      ? `Settlement opens in ${countdown(deal.end_unix, now)}.`
                      : "Settle becomes available once the monitoring window closes."}
                  </p>
                  {deal.status === "ACTIVE" ? (
                    <p className="mt-3 font-mono text-[0.62rem] text-muted">
                      current probe uptime {bpsToPercent(probeUptime)} · target{" "}
                      {bpsToPercent(deal.uptime_target_bps)}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <PayoutLedger info={payoutInfo} now={now} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileJson2 className="size-4 text-mist-dim" /> Committed terms
              </CardTitle>
              <CardDescription>
                The digest is what both parties agreed to before any money moved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Term label="service" value={deal.service} />
                <Term label="window" value={`${formatDuration(deal.window_seconds)} · ${formatUnix(deal.end_unix)}`} />
                <Term label="slots" value={`${deal.slots} × ${formatDuration(deal.slot_seconds)}`} />
                <Term label="uptime target" value={bpsToPercent(deal.uptime_target_bps)} />
                <Term label="coverage floor" value={bpsToPercent(deal.min_coverage_bps)} />
                <Term
                  label="expected status"
                  value={
                    terms?.expect_status && terms.expect_status > 0
                      ? String(terms.expect_status)
                      : "any 2xx"
                  }
                />
                <Term label="monitor" value={deal.monitor || "none"} mono />
                <Term
                  label="attestation"
                  value={deal.attestation_url || "none"}
                  mono
                />
              </dl>
              <div className="mt-5 border-y border-line-soft py-3">
                <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-muted">
                  terms digest
                </p>
                <p className="mt-1.5 break-all font-mono text-[0.68rem] text-watch">
                  {deal.terms_digest}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-4 text-mist-dim" /> Record
              </CardTitle>
              <CardDescription>
                Contract events for this deal, newest first. Money is only moved by
                finalize.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EventList entries={events.data ?? []} loading={events.loading} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <ActionPanel
            deal={deal}
            audit={audit}
            payoutInfo={payoutInfo}
            now={now}
            nextSlot={nextSlot}
            onDone={refreshAll}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4 text-mist-dim" /> Parties
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <Party label="client" value={deal.client} you={sameAddress(deal.client, address)} />
              <Party
                label="provider"
                value={deal.provider}
                you={sameAddress(deal.provider, address)}
              />
              <Party
                label="monitor"
                value={deal.monitor}
                you={sameAddress(deal.monitor, address)}
                empty="no monitor"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Economics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <Row label="escrow" value={`${formatGen(deal.escrow_atto)} GEN`} />
              <Row
                label="appeal bond"
                value={
                  deal.appeal_bond_atto && deal.appeal_bond_atto !== "0"
                    ? `${formatGen(deal.appeal_bond_atto)} GEN`
                    : `min ${formatGen(appealBondFor(deal.escrow_atto))} GEN`
                }
              />
              <Row
                label="paid to provider"
                value={deal.settled ? `${formatGen(deal.release_bps ? (BigInt(deal.escrow_atto) * BigInt(deal.release_bps)) / 10000n : 0n)} GEN` : "—"}
              />
              <Row
                label="returned to client"
                value={deal.settled ? `${formatGen(deal.release_bps ? BigInt(deal.escrow_atto) - (BigInt(deal.escrow_atto) * BigInt(deal.release_bps)) / 10000n : BigInt(deal.escrow_atto))} GEN` : "—"}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function VerdictBody({
  deal,
  audit,
  now,
}: {
  deal: Deal;
  audit: DealAudit | null;
  now: number;
}) {
  const release = deal.release_bps;
  const providerPct = release / 100;
  const escrow = BigInt(deal.escrow_atto);
  const providerCut = (escrow * BigInt(release)) / 10000n;
  const clientCut = escrow - providerCut;
  const contested = deal.appeal_bond_atto !== "0" && deal.appeal_bond_atto !== "";
  const appealReturned = deal.appeal_decided && contested && deal.appeal_evidence_unavailable;
  const appellantWon =
    deal.appeal_decided && contested && !appealReturned
      ? sameAddress(deal.appellant, deal.client)
        ? deal.release_bps < deal.first_release_bps
        : deal.release_bps > deal.first_release_bps
      : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p
          className={cn(
            "font-display text-2xl font-semibold",
            deal.outcome === "MET" ? "text-signal" : "text-loss",
          )}
        >
          {OUTCOME_LABEL[deal.outcome] ?? deal.outcome}
        </p>
        <span className="font-mono text-[0.66rem] text-muted">
          measured {bpsToPercent(deal.uptime_bps)} · target{" "}
          {bpsToPercent(deal.uptime_target_bps)}
        </span>
      </div>

      <div className="mt-5">
        <div className="flex h-2 overflow-hidden bg-panel-3">
          <div className="bg-signal/85" style={{ width: `${providerPct}%` }} />
          <div className="bg-watch/80" style={{ width: `${100 - providerPct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[0.62rem]">
          <span className="text-signal">provider {providerPct.toFixed(1)}%</span>
          <span className="text-watch-bright">client {(100 - providerPct).toFixed(1)}%</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px border border-line-soft bg-line-soft">
        <Stat label="provider receives" value={`${formatGen(providerCut)} GEN`} tone="signal" />
        <Stat label="client receives" value={`${formatGen(clientCut)} GEN`} tone="watch" />
      </div>

      {contested ? (
        <div className="mt-5 border-l border-loss/60 pl-3.5 text-[0.72rem] leading-relaxed text-mist-dim">
          <p className="font-medium text-loss">
            Appeal by {shortAddress(deal.appellant)} · bond {formatGen(deal.appeal_bond_atto)} GEN
          </p>
          <p className="mt-1">
            First verdict released {bpsToPercent(deal.first_release_bps)}; the re-derivation
            released {bpsToPercent(deal.release_bps)}.{" "}
            {deal.appeal_decided
              ? appealReturned
                ? "Fresh evidence was unavailable, so the tentative verdict stands and the bond is returned."
                : appellantWon
                  ? "The appellant won and the bond is returned."
                  : "The appellant lost and the bond goes to the counterparty."
              : `The appeal is decided by re-derivation; the bond resolves at finalize.`}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          {deal.status === "RESOLVED" && !deal.final
            ? `appeal window closes in ${countdown(deal.appeal_deadline_unix, now)}`
            : deal.status === "FINALIZED"
              ? "finalized — decision closed; delivery tracked"
              : deal.status === "APPEALED"
                ? "awaiting re-derivation"
                : `resolved ${formatUnix(deal.resolved_at_unix)}`}
        </span>
        {audit ? (
          <span className="font-mono text-muted">
            {audit.attested ? `attested ${bpsToPercent(audit.attested_bps)}` : "probe verdict"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ActionPanel({
  deal,
  audit,
  payoutInfo,
  now,
  nextSlot,
  onDone,
}: {
  deal: Deal;
  audit: DealAudit | null;
  payoutInfo: PayoutInfo | null;
  now: number;
  nextSlot: number | null;
  onDone: () => void;
}) {
  const { address, onCorrectChain } = useWallet();
  const { busy, phase, error, result, run, clear } = useTx();
  const role = roleOf(deal, address);
  const connected = !!address && onCorrectChain;
  const disabled = busy || !connected;
  const payouts = payoutInfo?.payouts ?? [];
  const myOwed = address
    ? payouts.filter((row) => row.state === "owed" && sameAddress(row.recipient, address))
    : [];
  const sentPayout = payouts.find((row) => row.state === "sent") ?? null;
  const owedPayout = payouts.find((row) => row.state === "owed") ?? null;
  const sentAge = sentPayout ? now - sentPayout.sent_at_unix : 0;
  const sentRecoverable = sentPayout ? sentAge >= (payoutInfo?.grace_seconds ?? PROTOCOL.payoutGraceSec) : false;
  const payoutOpen = payouts.some((row) => row.state !== "delivered");

  const [fundAmount, setFundAmount] = React.useState("1");
  const [bondOverride, setBondOverride] = React.useState<string | null>(null);
  const bondAmount = bondOverride ?? formatGen(appealBondFor(deal.escrow_atto));
  const [reportJson, setReportJson] = React.useState(() =>
    JSON.stringify(
      {
        service: deal.service,
        window_seconds: deal.window_seconds,
        uptime_bps: 10000,
        nonce: "report-1",
      },
      null,
      2,
    ),
  );
  const [nonce, setNonce] = React.useState("report-1");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [digestState, setDigestState] = React.useState<{
    source: string;
    digest: string | null;
    error: string | null;
  }>({ source: "", digest: null, error: null });

  const parsedReport = React.useMemo(() => {
    try {
      const parsed = JSON.parse(reportJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { value: null, error: "The report must be a JSON object." };
      }
      return { value: parsed, error: null };
    } catch (err) {
      return {
        value: null,
        error: err instanceof Error ? err.message : "Invalid JSON.",
      };
    }
  }, [reportJson]);

  const digest = digestState.source === reportJson ? digestState.digest : null;
  const reportError =
    parsedReport.error ??
    (digestState.source === reportJson ? digestState.error : null);

  React.useEffect(() => {
    if (!parsedReport.value) return;
    let cancelled = false;
    canonicalDigest(parsedReport.value)
      .then((value) => {
        if (!cancelled) {
          setDigestState({ source: reportJson, digest: value, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDigestState({
            source: reportJson,
            digest: null,
            error: "Could not hash the report in this browser.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [parsedReport, reportJson]);

  const exec = async (fn: Parameters<typeof run>[0]): Promise<WriteResult | null> => {
    setLocalError(null);
    const res = await run(fn);
    if (res?.ok) onDone();
    return res;
  };

  const doFund = () => {
    let amount: bigint;
    try {
      amount = parseGen(fundAmount);
    } catch {
      setLocalError("Enter a valid GEN amount.");
      return;
    }
    if (amount < PROTOCOL.minEscrowAtto) {
      setLocalError("The escrow must be at least 1 atto.");
      return;
    }
    void exec((client, onPhase) => fundDeal(client, deal.id, amount, onPhase));
  };

  const doAppeal = () => {
    let bond: bigint;
    try {
      bond = parseGen(bondAmount);
    } catch {
      setLocalError("Enter a valid bond amount.");
      return;
    }
    if (bond < appealBondFor(deal.escrow_atto)) {
      setLocalError(`The bond must be at least ${formatGen(appealBondFor(deal.escrow_atto))} GEN.`);
      return;
    }
    void exec((client, onPhase) => fileAppealTx(client, deal.id, bond, onPhase));
  };

  const doCommit = () => {
    if (!digest) {
      setLocalError("The report is not hashing to a digest yet.");
      return;
    }
    void exec((client, onPhase) =>
      commitAttestation(client, deal.id, digest, nonce, onPhase),
    );
  };

  const windowOpen = deal.status === "ACTIVE";
  const monitoringOpen =
    deal.status === "ACTIVE" ||
    ((deal.status === "APPEALED" || (deal.status === "RESOLVED" && !deal.final)) &&
      now <= deal.appeal_deadline_unix);
  const probeHint = windowOpen
    ? "Permissionless. Validators refetch the committed endpoint and agree on UP/DOWN."
    : monitoringOpen
      ? "Late probes filed before the appeal deadline still count in a re-derivation."
      : "The evidence window has closed; the verdict can no longer change.";
  const appealOpen = deal.status === "RESOLVED" && !deal.final && now <= deal.appeal_deadline_unix;
  const canResolveAppeal = deal.status === "APPEALED" && now > deal.appeal_deadline_unix;
  const canFinalize = deal.status === "RESOLVED" && now > deal.appeal_deadline_unix;
  const lapsed = isLapsed(deal, now);
  const authoritativeProbes = probeCoverageAuthoritative(deal);
  const thinCoverage = deal.probed_slots > 0 && !authoritativeProbes && !deal.attested;
  const base = Math.floor((now - deal.started_at_unix) / Math.max(1, deal.slot_seconds));
  const nextStart =
    deal.started_at_unix + Math.max(0, base + 1) * Math.max(1, deal.slot_seconds);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Actions</CardTitle>
          <Badge tone="neutral">{role}</Badge>
        </div>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-muted">
          {STATUS_NOTE[deal.status] ?? ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!address ? (
          <p className="border-l border-line pl-3.5 text-[0.72rem] text-muted">
            Connect a wallet from the header to sign an action.
          </p>
        ) : !onCorrectChain ? (
          <p className="border-l-2 border-watch bg-watch/[0.05] px-3 py-2 text-[0.72rem] text-watch-bright">
            Switch your wallet to Genlayer Studio Network.
          </p>
        ) : null}

        {deal.status === "OPEN" && role === "client" ? (
          <Section title="Fund the escrow" hint="The GEN you send becomes the escrow.">
            <Field label="Amount (GEN)" htmlFor="fund">
              <Input
                id="fund"
                value={fundAmount}
                onChange={(event) => {
                  setFundAmount(event.target.value);
                  clear();
                }}
                inputMode="decimal"
                className="font-mono"
              />
            </Field>
            <Button className="w-full" onClick={doFund} disabled={disabled}>
              Fund escrow
            </Button>
          </Section>
        ) : null}

        {["OPEN", "FUNDED"].includes(deal.status) && role === "client" ? (
          <Section title="Exit before the window" hint="Cancelling returns the whole escrow to the client.">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => exec((client, onPhase) => cancelDeal(client, deal.id, onPhase))}
              disabled={disabled}
            >
              Cancel deal
            </Button>
          </Section>
        ) : null}

        {deal.status === "FUNDED" && role === "provider" ? (
          <Section title="Start the window" hint="The start timestamp fixes every slot's schedule.">
            <Button
              variant="watch"
              className="w-full"
              onClick={() => exec((client, onPhase) => startDeal(client, deal.id, onPhase))}
              disabled={disabled}
            >
              Start monitoring
            </Button>
          </Section>
        ) : null}

        {deal.status === "OPEN" && role !== "client" ? (
          <p className="border-l border-line pl-3.5 text-[0.72rem] text-muted">
            Waiting for the client ({shortAddress(deal.client)}) to fund.
          </p>
        ) : null}

        {deal.status === "FUNDED" && role !== "provider" && role !== "client" ? (
          <p className="border-l border-line pl-3.5 text-[0.72rem] text-muted">
            Waiting for the provider ({shortAddress(deal.provider)}) to start.
          </p>
        ) : null}

        {windowOpen ? (
          <div className="flex items-center justify-between border-y border-line-soft py-2.5 font-mono text-[0.64rem]">
            <span className="text-muted">window closes</span>
            <span className="text-mist-dim tabular">{countdown(deal.end_unix, now)}</span>
          </div>
        ) : null}

        {monitoringOpen ? (
          <>
            <Section
              title={nextSlot !== null ? `Probe slot ${nextSlot}` : "Probe a slot"}
              hint={probeHint}
            >
              {nextSlot !== null ? (
                <Button
                  className="w-full"
                  onClick={() =>
                    exec((client, onPhase) =>
                      probeSlot(client, deal.id, nextSlot as number, onPhase),
                    )
                  }
                  disabled={disabled}
                >
                  <Radio /> Record sample
                </Button>
              ) : (
                <p className="text-xs text-muted">
                  No slot is open right now.{" "}
                  {base + 1 < deal.slots
                    ? `The next opens ${relativeTime(nextStart, now)}.`
                    : "All slots have passed."}
                </p>
              )}
            </Section>

            {role === "monitor" ? (
              <Section
                title="Commit an attestation"
                hint="Publish the report at the attested URL first. The digest is the binding. Re-committing is allowed while the appeal window is open."
              >
                <Textarea
                  value={reportJson}
                  onChange={(event) => setReportJson(event.target.value)}
                  className="min-h-32 font-mono text-[0.68rem]"
                  spellCheck={false}
                />
                <Field label="Nonce" htmlFor="nonce">
                  <Input
                    id="nonce"
                    value={nonce}
                    onChange={(event) => setNonce(event.target.value)}
                    maxLength={120}
                    className="font-mono"
                  />
                </Field>
                <p className="break-all font-mono text-[0.64rem] text-watch">
                  sha256 {digest ?? "—"}
                </p>
                {reportError ? (
                  <p className="text-xs text-loss">{reportError}</p>
                ) : null}
                <Button
                  variant="watch"
                  className="w-full"
                  onClick={doCommit}
                  disabled={disabled || !digest}
                >
                  Commit digest
                </Button>
              </Section>
            ) : null}
          </>
        ) : null}

        {windowOpen ? (
          <>
            {audit?.attested_digest ? (
              <Section
                title="Record the attested reading"
                hint="Validators refetch the URL and re-hash it. A changed report is rejected."
              >
                <p className="break-all font-mono text-[0.64rem] text-muted">
                  committed {shortDigest(audit.attested_digest, 8)}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    exec((client, onPhase) => submitAttestation(client, deal.id, onPhase))
                  }
                  disabled={disabled}
                >
                  Fetch and record
                </Button>
              </Section>
            ) : null}

            {now >= deal.end_unix && hasEvidence(deal) ? (
              <Section
                title="Settle the window"
                hint="Writes a tentative verdict and opens the one-hour appeal window. No money moves yet."
              >
                <Button
                  variant="watch"
                  className="w-full"
                  onClick={() => exec((client, onPhase) => settle(client, deal.id, onPhase))}
                  disabled={disabled}
                >
                  Settle · tentative
                </Button>
              </Section>
            ) : null}

            {now >= deal.end_unix && !hasEvidence(deal) && !lapsed ? (
              <p className="border-l border-line pl-3.5 text-[0.72rem] leading-relaxed text-muted">
                {thinCoverage
                  ? `Probe coverage is ${bpsToPercent(coverageBps(deal))}, below the ${bpsToPercent(deal.min_coverage_bps)} floor, and no attestation is recorded. Settlement refuses a token sample; the client may claim an inconclusive refund `
                  : "The window closed with no probes or attestation. Settlement has nothing to read; the client may claim the lapse "}
                {relativeTime(deal.end_unix + PROTOCOL.lapseGraceSec, now)}.
              </p>
            ) : null}

            {lapsed ? (
              <Section
                title={thinCoverage ? "Claim an inconclusive refund" : "Claim the lapse"}
                hint={
                  thinCoverage
                    ? "Coverage stayed below the floor and no attestation was recorded. After the grace the escrow returns to the client."
                    : "The window closed with no evidence and the grace has passed. The escrow returns to the client."
                }
              >
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => exec((client, onPhase) => claimLapsed(client, deal.id, onPhase))}
                  disabled={disabled}
                >
                  Claim lapsed escrow
                </Button>
              </Section>
            ) : null}
          </>
        ) : null}

        {appealOpen ? (
          role === "client" || role === "provider" ? (
            <Section
              title="Contest the verdict"
              hint={`Stake a bond of at least ${formatGen(appealBondFor(deal.escrow_atto))} GEN. The loser forfeits it to the counterparty.`}
            >
              <Field label="Bond (GEN)" htmlFor="bond">
                <Input
                  id="bond"
                  value={bondAmount}
                  onChange={(event) => {
                    setBondOverride(event.target.value);
                    clear();
                  }}
                  inputMode="decimal"
                  className="font-mono"
                />
              </Field>
              <Button variant="watch" className="w-full" onClick={doAppeal} disabled={disabled}>
                File appeal
              </Button>
              <p className="text-center font-mono text-[0.62rem] text-muted">
                window closes in {countdown(deal.appeal_deadline_unix, now)}
              </p>
            </Section>
          ) : (
            <p className="border-l border-line pl-3.5 text-[0.72rem] text-muted">
              A tentative verdict is open for appeal until{" "}
              {countdown(deal.appeal_deadline_unix, now)}. Only a party may file.
            </p>
          )
        ) : null}

        {deal.status === "APPEALED" ? (
          canResolveAppeal ? (
            <Section
              title="Re-derive the verdict"
              hint="Folds in late probes and re-fetches the committed attestation. The second verdict is final."
            >
              <Button
                className="w-full"
                onClick={() => exec((client, onPhase) => resolveAppeal(client, deal.id, onPhase))}
                disabled={disabled}
              >
                Resolve appeal
              </Button>
            </Section>
          ) : (
            <Section
              title="Evidence window still open"
              hint="Late probes and a corrected attestation remain admissible until the deadline. Resolution unlocks after that."
            >
              <p className="text-center font-mono text-[0.68rem] text-muted">
                evidence closes in {countdown(deal.appeal_deadline_unix, now)}
              </p>
            </Section>
          )
        ) : null}

        {canFinalize ? (
          <Section
            title="Finalize"
            hint="Pays the standing split and settles any bond. Permissionless."
          >
            <Button
              variant="watch"
              className="w-full"
              onClick={() => exec((client, onPhase) => finalize(client, deal.id, onPhase))}
              disabled={disabled}
            >
              Pay out escrow
            </Button>
          </Section>
        ) : null}

        {payoutOpen ? (
          <Section
            title="Payout delivery"
            hint="A decided payout is only booked once the value is observed to have left. One payout may be in flight at a time."
          >
            {sentPayout ? (
              <div className="border-y border-line-soft py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.64rem] text-mist-dim">
                    {sentPayout.kind} · {formatGen(sentPayout.amount_atto)} GEN
                  </span>
                  <Badge tone="watch">sent</Badge>
                </div>
                <p className="mt-1.5 font-mono text-[0.6rem] text-muted">
                  {sentRecoverable
                    ? `attempt ${sentPayout.attempts} · grace passed`
                    : `attempt ${sentPayout.attempts} · grace closes in ${formatDuration(
                        Math.max(0, (payoutInfo?.grace_seconds ?? PROTOCOL.payoutGraceSec) - sentAge),
                      )}`}
                </p>
              </div>
            ) : null}

            {sentPayout && sentRecoverable ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exec((client, onPhase) =>
                      confirmPayout(client, deal.id, sentPayout.kind, onPhase),
                    )
                  }
                  disabled={disabled}
                >
                  Confirm delivery
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    exec((client, onPhase) =>
                      recoverPayout(client, deal.id, sentPayout.kind, onPhase),
                    )
                  }
                  disabled={disabled}
                >
                  Mark undelivered
                </Button>
              </div>
            ) : null}

            {myOwed.length > 0 ? (
              <div className="space-y-2">
                {myOwed.map((row) => (
                  <Button
                    key={row.kind}
                    variant="watch"
                    className="w-full"
                    onClick={() =>
                      exec((client, onPhase) =>
                        retryPayout(client, deal.id, row.kind, onPhase),
                      )
                    }
                    disabled={disabled || !!sentPayout}
                  >
                    Retry {row.kind} payout · {formatGen(row.amount_atto)} GEN
                  </Button>
                ))}
              </div>
            ) : null}

            {owedPayout && !sentPayout ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exec((client, onPhase) => pumpPayouts(client, onPhase))}
                disabled={disabled}
              >
                Send next payout
              </Button>
            ) : null}

            {!sentPayout && myOwed.length === 0 ? (
              <p className="text-[0.72rem] text-muted">
                No payout is awaiting delivery from this wallet. Any owed payout can
                still be sent permissionlessly.
              </p>
            ) : null}
          </Section>
        ) : null}

        {["FINALIZED", "REFUNDED"].includes(deal.status) ? (
          <p className="border-l border-line pl-3.5 text-[0.72rem] text-muted">
            The verdict is closed. Payout delivery, if any, is tracked above.
          </p>
        ) : null}

        {localError ? (
          <p className="border-l-2 border-loss bg-loss/[0.05] px-3 py-2 text-[0.72rem] text-loss">
            {localError}
          </p>
        ) : null}
        {error ? (
          <p className="border-l-2 border-loss bg-loss/[0.05] px-3 py-2 text-[0.72rem] text-loss">
            {error}
          </p>
        ) : null}
        {phase === "waiting" ? (
          <p className="animate-pulse text-center font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">
            Waiting for consensus…
          </p>
        ) : null}
        {result?.ok ? (
          <p className="break-all border-l-2 border-signal bg-signal/[0.05] px-3 py-2 font-mono text-[0.66rem] text-signal">
            Confirmed · {shortAddress(result.hash, 8)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayoutLedger({ info, now }: { info: PayoutInfo | null; now: number }) {
  if (!info || info.payouts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4 text-mist-dim" /> Payout delivery
        </CardTitle>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-muted">
          A verdict creates obligations. Delivery is booked only after the value is
          observed to leave, so totals can lag the decision.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {info.payouts.map((row) => (
          <div key={row.kind} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-mist-dim">
                {row.kind}
              </span>
              <Badge
                tone={
                  row.state === "delivered"
                    ? "signal"
                    : row.state === "sent"
                      ? "watch"
                      : "neutral"
                }
              >
                {row.state}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="font-display text-[1.15rem] tabular text-mist">
                {formatGen(row.amount_atto)} <span className="text-[0.7rem] text-muted">GEN</span>
              </span>
              <span className="font-mono text-[0.62rem] text-muted">
                {row.state === "delivered"
                  ? `delivered ${relativeTime(row.delivered_at_unix, now)}`
                  : row.state === "sent"
                    ? `attempt ${row.attempts}`
                    : "awaiting send"}
              </span>
            </div>
            <p className="mt-1 font-mono text-[0.62rem] text-muted">
              to {shortAddress(row.recipient)} · {row.memo}
            </p>
            {row.returned_atto !== "0" ? (
              <p className="mt-1 font-mono text-[0.6rem] text-watch">
                returned {formatGen(row.returned_atto)} GEN
              </p>
            ) : null}
          </div>
        ))}
        {info.in_flight ? (
          <p className="border-l border-watch/50 pl-3 font-mono text-[0.62rem] text-watch-bright">
            in flight: {info.in_flight}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventList({ entries, loading }: { entries: LogEntry[]; loading: boolean }) {
  if (loading && entries.length === 0) {
    return <p className="text-xs text-muted">Loading the record…</p>;
  }
  if (entries.length === 0) {
    return <p className="text-xs text-muted">No events recorded for this deal yet.</p>;
  }
  return (
    <ul className="divide-y divide-line-soft">
      {entries
        .slice()
        .reverse()
        .map((entry, index) => (
          <li key={`${entry.event}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
            <span className="font-mono text-[0.66rem] text-signal">{entry.event}</span>
            <span className="font-mono text-[0.66rem] text-muted">{summarize(entry)}</span>
          </li>
        ))}
    </ul>
  );
}

function summarize(entry: LogEntry): string {
  return Object.entries(entry)
    .filter(([key]) => key !== "event" && key !== "id")
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l border-line pl-3.5">
      <p className="text-[0.8rem] font-medium text-mist">{title}</p>
      {hint ? <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">{hint}</p> : null}
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Summary({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "signal" | "loss";
}) {
  return (
    <div className="min-w-0 bg-void/55 px-4 py-4">
      <p className="font-mono text-[0.52rem] uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 truncate font-display text-[clamp(1.1rem,2.2vw,1.4rem)] leading-none",
          tone === "signal" && "text-signal",
          tone === "loss" && "text-loss",
        )}
        title={value}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate font-mono text-[0.52rem] uppercase tracking-[0.12em] text-muted">
        {note}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "signal" | "loss" | "watch";
}) {
  return (
    <div className="bg-void/45 px-3.5 py-3">
      <p className="font-mono text-[0.52rem] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate font-display text-[1.25rem] leading-none text-mist tabular",
          tone === "signal" && "text-signal",
          tone === "loss" && "text-loss",
          tone === "watch" && "text-watch",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Meter({
  label,
  value,
  target,
  tone,
  targetLabel,
}: {
  label: string;
  value: number;
  target: number;
  tone: "signal" | "loss" | "watch";
  targetLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[0.62rem] text-muted">
        <span>{label}</span>
        <span className="text-mist-dim">{bpsToPercent(value)}</span>
      </div>
      <div className="relative mt-2 h-1 bg-panel-3">
        <div
          className={cn(
            "h-full transition-[width] duration-700",
            tone === "signal" && "bg-signal/85",
            tone === "loss" && "bg-loss/85",
            tone === "watch" && "bg-watch/85",
          )}
          style={{ width: `${Math.min(100, value / 100)}%` }}
        />
        <span
          className="absolute -top-1 h-3 w-px bg-mist/60"
          style={{ left: `${Math.min(100, target / 100)}%` }}
          title={`${targetLabel} ${bpsToPercent(target)}`}
        />
      </div>
    </div>
  );
}

function Term({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.56rem] uppercase tracking-[0.2em] text-muted">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm text-mist-dim",
          mono && "break-all font-mono text-[0.7rem]",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className="text-[0.72rem] text-muted">{label}</span>
      <span className="font-display text-[1.05rem] tabular text-mist-dim">{value}</span>
    </div>
  );
}

function Party({
  label,
  value,
  you,
  empty,
}: {
  label: string;
  value: string;
  you?: boolean;
  empty?: string;
}) {
  const zero = !value || value === "0x0000000000000000000000000000000000000000";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      <span className="flex items-center gap-2">
        {you ? <Badge tone="signal">you</Badge> : null}
        <span className="font-mono text-xs text-mist-dim">
          {zero ? (empty ?? "—") : shortAddress(value, 6)}
        </span>
      </span>
    </div>
  );
}
