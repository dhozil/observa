"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-context";
import type { GenLayer } from "@/lib/genlayer";
import {
  humanizeError,
  type PhaseReporter,
  type TxPhase,
  type WriteResult,
} from "@/lib/observa";

export type TxRun = (client: GenLayer, onPhase: PhaseReporter) => Promise<WriteResult>;

export function useTx() {
  const { write } = useWallet();
  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<TxPhase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<WriteResult | null>(null);

  // A ref, not state: a second click can fire before `busy` has re-rendered the
  // button, and two concurrent writes on the same nonce fail messily.
  const inFlight = React.useRef(false);

  const run = React.useCallback(
    async (fn: TxRun) => {
      if (!write) {
        setError("Connect a wallet to sign this action.");
        return null;
      }
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setPhase("signing");
      setError(null);
      setResult(null);
      try {
        const res = await fn(write, setPhase);
        setResult(res);
        if (res.ok) {
          setPhase("confirmed");
        } else {
          setError(res.message);
          setPhase("idle");
        }
        return res;
      } catch (err) {
        setError(humanizeError(err));
        setPhase("idle");
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [write],
  );

  const clear = React.useCallback(() => {
    setError(null);
    setResult(null);
    setPhase("idle");
  }, []);

  return { busy, phase, error, result, run, clear, canSign: !!write };
}
