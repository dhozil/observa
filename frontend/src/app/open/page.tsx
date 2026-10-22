"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, FileJson2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ConfigNotice } from "@/components/config-notice";
import { useWallet } from "@/components/wallet/wallet-context";
import { useDealIds } from "@/hooks/use-contract";
import { useTx } from "@/hooks/use-tx";
import {
  canonicalDigest,
  canonicalJson,
  getDealIds,
  isConfigured,
  openDeal,
  type DealTerms,
} from "@/lib/observa";
import { bpsToPercent, formatDuration, percentToBps, shortDigest } from "@/lib/format";

type Unit = "minutes" | "hours" | "days";

const UNITS: Record<Unit, number> = { minutes: 60, hours: 3600, days: 86400 };

const DEFAULTS = {
  provider: "",
  service: "",
  endpoint: "",
  windowValue: "1",
  unit: "hours" as Unit,
  slots: "60",
  targetPercent: "99",
  minCoveragePercent: "50",
  expectStatus: "0",
  monitor: "",
  attestationUrl: "",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

export default function OpenPage() {
  const router = useRouter();
  const { address, read, onCorrectChain } = useWallet();
  const { busy, phase, error, run, clear } = useTx();
  const ids = useDealIds();

  const [form, setForm] = React.useState(DEFAULTS);
  const [showProblems, setShowProblems] = React.useState(false);
  const [digest, setDigest] = React.useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clear();
  };

  const windowSeconds = React.useMemo(() => {
    const value = Number(form.windowValue);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(1, Math.round(value * UNITS[form.unit]));
  }, [form.windowValue, form.unit]);

  const slots = Number(form.slots);
  const slotSeconds = slots > 0 ? Math.floor(windowSeconds / slots) : 0;

  const terms = React.useMemo<DealTerms>(() => {
    const parsed: DealTerms = {
      service: form.service.trim(),
      endpoint: form.endpoint.trim(),
      window_seconds: windowSeconds,
      slots,
      uptime_target_bps: percentToBps(form.targetPercent),
      min_coverage_bps: percentToBps(form.minCoveragePercent),
      expect_status: Number(form.expectStatus) || 0,
    };
    if (form.monitor.trim()) {
      parsed.monitor = form.monitor.trim();
      parsed.attestation_url = form.attestationUrl.trim();
    }
    return parsed;
  }, [form, windowSeconds, slots]);

  const termsJson = React.useMemo(() => canonicalJson(terms), [terms]);

  React.useEffect(() => {
    let cancelled = false;
    canonicalDigest(terms)
      .then((value) => {
        if (!cancelled) setDigest(value);
      })
      .catch(() => {
        if (!cancelled) setDigest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [terms]);

  const problems = React.useMemo(() => {
    const list: string[] = [];
    if (!ADDRESS_RE.test(form.provider.trim())) {
      list.push("Provider must be a 0x address.");
    } else if (form.provider.trim().toLowerCase() === ZERO) {
      list.push("Provider must not be the zero address.");
    } else if (address && form.provider.trim().toLowerCase() === address.toLowerCase()) {
      list.push("Client and provider must differ.");
    }
    if (!form.service.trim()) list.push("Name the service.");
    if (form.service.trim().length > 200) list.push("Service name must be 200 characters or fewer.");
    if (!/^https:\/\//.test(form.endpoint.trim())) list.push("Endpoint must start with https://.");
    if (windowSeconds <= 0) list.push("Window must be a positive duration.");
    if (!Number.isInteger(slots) || slots < 1 || slots > 720) {
      list.push("Slots must be a whole number between 1 and 720.");
    }
    if (slots > 0 && windowSeconds < slots) {
      list.push("The window must be at least as long as the slot count (one second per slot).");
    }
    const target = percentToBps(form.targetPercent);
    if (target < 1 || target > 10000) list.push("Uptime target must be between 0.01% and 100%.");
    const coverage = percentToBps(form.minCoveragePercent);
    if (coverage < 0 || coverage > 10000) list.push("Minimum coverage must be between 0% and 100%.");
    const status = Number(form.expectStatus);
    if (!Number.isInteger(status) || (status !== 0 && (status < 100 || status > 599))) {
      list.push("Expected status must be 0 or an HTTP status between 100 and 599.");
    }
    if (form.monitor.trim()) {
      if (!ADDRESS_RE.test(form.monitor.trim()) || form.monitor.trim().toLowerCase() === ZERO) {
        list.push("Monitor must be a non-zero 0x address.");
      }
      if (!/^https:\/\//.test(form.attestationUrl.trim())) {
        list.push("A monitor requires an https attestation URL.");
      }
    } else if (form.attestationUrl.trim() && !/^https:\/\//.test(form.attestationUrl.trim())) {
      list.push("Attestation URL must start with https://.");
    }
    return list;
  }, [form, address, windowSeconds, slots]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShowProblems(true);
    if (problems.length || !address || !onCorrectChain) return;

    const before = ids.data?.length ?? 0;
    const result = await run((client, onPhase) =>
      openDeal(client, form.provider.trim(), termsJson, onPhase),
    );
    if (!result?.ok) return;

    const dealId = await findNewDeal(read, before);
    router.push(dealId ? `/deal/${dealId}` : "/market");
  };

  const phaseLabel =
    phase === "signing"
      ? "Confirm in your wallet…"
      : phase === "waiting"
        ? "Waiting for consensus…"
        : phase === "confirmed"
          ? "Committed."
          : "Open the deal";

  return (
    <div className="mx-auto max-w-[1360px] px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-7">
        <div className="max-w-2xl">
          <p className="eyebrow text-muted">New commitment</p>
          <h1 className="mt-4 font-display text-[clamp(2.7rem,5vw,4.2rem)] leading-[0.95] text-veil">
            Open an uptime deal
          </h1>
          <p className="mt-4 text-[0.88rem] leading-relaxed text-mist-dim text-veil">
            The terms are fixed and hashed on-chain before money moves. Open the deal,
            then fund the escrow from the deal page; the provider starts the window.
          </p>
        </div>
        <p className="hidden font-mono text-[0.56rem] uppercase leading-relaxed tracking-[0.16em] text-muted sm:block">
          Step 01 — commit
          <br />
          Step 02 — fund
          <br />
          Step 03 — observe
        </p>
      </div>

      <ConfigNotice className="mt-6 max-w-2xl" />

      <form onSubmit={submit} className="mt-9 grid gap-8 lg:grid-cols-[1.12fr_0.88fr]">
        <Card>
          <CardHeader>
            <CardTitle>01 — Terms</CardTitle>
            <p className="mt-2 text-[0.8rem] leading-relaxed text-muted">
              The committed endpoint is exactly what validators fetch at probe time.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Provider" htmlFor="provider" hint="The address that receives the release.">
              <Input
                id="provider"
                value={form.provider}
                onChange={(event) => set("provider", event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Service" htmlFor="service">
                <Input
                  id="service"
                  value={form.service}
                  onChange={(event) => set("service", event.target.value)}
                  placeholder="acme-edge"
                  maxLength={200}
                />
              </Field>
              <Field label="Probe path" htmlFor="endpoint" hint="HTTPS only.">
                <Input
                  id="endpoint"
                  value={form.endpoint}
                  onChange={(event) => set("endpoint", event.target.value)}
                  placeholder="https://api.example.com/health"
                  inputMode="url"
                  spellCheck={false}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Window" htmlFor="window">
                <Input
                  id="window"
                  type="number"
                  min={1}
                  step={1}
                  value={form.windowValue}
                  onChange={(event) => set("windowValue", event.target.value)}
                />
              </Field>
              <Field label="Unit" htmlFor="unit">
                <Select
                  id="unit"
                  value={form.unit}
                  onChange={(event) => set("unit", event.target.value as Unit)}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </Select>
              </Field>
              <Field label="Slots" htmlFor="slots" hint="1–720 samples.">
                <Input
                  id="slots"
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={form.slots}
                  onChange={(event) => set("slots", event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Uptime target %" htmlFor="target">
                <Input
                  id="target"
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={form.targetPercent}
                  onChange={(event) => set("targetPercent", event.target.value)}
                />
              </Field>
              <Field label="Min coverage %" htmlFor="coverage" hint="Probe authority floor.">
                <Input
                  id="coverage"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={form.minCoveragePercent}
                  onChange={(event) => set("minCoveragePercent", event.target.value)}
                />
              </Field>
              <Field label="Expected status" htmlFor="status" hint="0 = any 2xx.">
                <Input
                  id="status"
                  type="number"
                  min={0}
                  max={599}
                  step={1}
                  value={form.expectStatus}
                  onChange={(event) => set("expectStatus", event.target.value)}
                />
              </Field>
            </div>

            <div className="border-l border-watch/40 pl-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-mist-dim">
                    Attested-report path
                  </p>
                  <p className="mt-1.5 text-[0.72rem] leading-relaxed text-muted">
                    Optional. A monitor commits a digest of its report on-chain; validators
                    refetch and re-hash it. There is no on-chain signature check.
                  </p>
                </div>
                <Badge tone="watch">optional</Badge>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Monitor address" htmlFor="monitor">
                  <Input
                    id="monitor"
                    value={form.monitor}
                    onChange={(event) => set("monitor", event.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Attestation URL" htmlFor="attestation">
                  <Input
                    id="attestation"
                    value={form.attestationUrl}
                    onChange={(event) => set("attestationUrl", event.target.value)}
                    placeholder="https://monitor.example/report.json"
                    inputMode="url"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>02 — Proof</CardTitle>
                <Badge tone={sliceFits(windowSeconds, slots) ? "signal" : "loss"}>
                  {slotSeconds > 0 ? `${formatDuration(slotSeconds)} / slot` : "invalid"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 border border-line-soft">
                <PreviewCell label="window" value={formatDuration(windowSeconds)} />
                <PreviewCell label="slots" value={String(slots || "—")} border />
                <PreviewCell label="target" value={bpsToPercent(terms.uptime_target_bps)} top />
                <PreviewCell
                  label="coverage floor"
                  value={bpsToPercent(terms.min_coverage_bps ?? 0)}
                  top
                  border
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
                    canonical terms
                  </p>
                  {digest ? (
                    <span className="font-mono text-[0.62rem] text-watch" title={digest}>
                      sha256 {shortDigest(digest, 5)}
                    </span>
                  ) : null}
                </div>
                <pre className="mt-2 max-h-56 overflow-auto border border-line-soft bg-void/55 p-3 font-mono text-[0.66rem] leading-relaxed text-mist-dim">
                  {JSON.stringify(terms, null, 2)}
                </pre>
              </div>

              <div className="space-y-2 border-l border-line pl-3.5 text-[0.72rem] leading-relaxed text-muted">
                <p className="flex items-center gap-2 text-mist-dim">
                  <Radio className="size-3.5 text-signal" /> Every slot accepts one probe.
                </p>
                <p className="flex items-center gap-2 text-mist-dim">
                  <FileJson2 className="size-3.5 text-watch" /> Settlement is integer-only:
                  full release at target, else pro-rata.
                </p>
              </div>
            </CardContent>
          </Card>

          {showProblems && problems.length > 0 ? (
            <div className="border-l-2 border-loss bg-loss/[0.05] px-4 py-3">
              <p className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-loss">
                <AlertTriangle className="size-3.5" /> Fix these first
              </p>
              <ul className="mt-2 space-y-1 text-[0.72rem] leading-relaxed text-loss/90">
                {problems.map((problem) => (
                  <li key={problem}>— {problem}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="border-l-2 border-loss bg-loss/[0.05] px-4 py-3 text-[0.8rem] text-loss">
              {error}
            </div>
          ) : null}

          {!address ? (
            <p className="border-l border-line pl-3.5 text-[0.78rem] text-muted">
              Connect a wallet in the header to sign the commitment.
            </p>
          ) : !onCorrectChain ? (
            <p className="border-l-2 border-watch bg-watch/[0.05] px-3.5 py-2 text-[0.78rem] text-watch-bright">
              Switch your wallet to Genlayer Studio Network before opening.
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || !isConfigured || !address || !onCorrectChain}
          >
            {phase === "waiting" ? (
              <span className="animate-pulse">Waiting for consensus…</span>
            ) : (
              <>
                {phaseLabel} <ArrowRight />
              </>
            )}
          </Button>

          {phase === "waiting" ? (
            <p className="text-center text-xs text-muted">
              Studionet consensus can take a minute. Keep this tab open.
            </p>
          ) : null}

          {isConfigured ? (
            <p className="flex items-center justify-center gap-1.5 text-center text-[0.68rem] text-muted">
              <Check className="size-3 text-signal" /> Escrow is funded in a second step on
              the deal page.
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function sliceFits(windowSeconds: number, slots: number): boolean {
  return windowSeconds > 0 && slots >= 1 && slots <= 720 && windowSeconds >= slots;
}

function PreviewCell({
  label,
  value,
  border,
  top,
}: {
  label: string;
  value: string;
  border?: boolean;
  top?: boolean;
}) {
  return (
    <div
      className={`bg-void/40 px-3.5 py-3 ${border ? "border-l border-line-soft" : ""} ${
        top ? "border-t border-line-soft" : ""
      }`}
    >
      <p className="font-mono text-[0.54rem] uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <p className="mt-1.5 truncate font-display text-[1.35rem] leading-none text-mist tabular">
        {value}
      </p>
    </div>
  );
}

async function findNewDeal(
  read: ReturnType<typeof useWallet>["read"],
  before: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const list = await getDealIds(read);
      if (list.length > before) return list[list.length - 1];
    } catch {
      /* the record may not be final yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}
