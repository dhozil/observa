"use client";

import * as React from "react";
import { useWallet } from "@/components/wallet/wallet-context";
import type { GenLayer } from "@/lib/genlayer";
import * as O from "@/lib/observa";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** A read that never settles would otherwise leave the page spinning forever. */
const READ_TIMEOUT_MS = 20000;
const READ_TIMEOUT_MESSAGE =
  "The node did not answer in time. Check your connection, then refresh.";

function useRead<T>(
  run: (client: GenLayer) => Promise<T>,
  key: string,
  options?: { refreshMs?: number },
): AsyncState<T> {
  const { read } = useWallet();
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const runRef = React.useRef(run);
  React.useEffect(() => {
    runRef.current = run;
  });

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(READ_TIMEOUT_MESSAGE)), READ_TIMEOUT_MS);
    });

    Promise.race([runRef.current(read), timeout])
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(O.humanizeError(err));
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [read, key, nonce]);

  React.useEffect(() => {
    if (!options?.refreshMs) return;
    const id = window.setInterval(() => setNonce((value) => value + 1), options.refreshMs);
    return () => window.clearInterval(id);
  }, [options?.refreshMs]);

  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading: data === null && error === null, refresh };
}

export function useStats(refreshMs?: number): AsyncState<O.Stats> {
  return useRead((client) => O.getStats(client), "", { refreshMs });
}

export function useConfig(): AsyncState<O.Config> {
  return useRead((client) => O.getConfig(client), "");
}

export function useDealIds(): AsyncState<string[]> {
  return useRead((client) => O.getDealIds(client), "");
}

export function useDeals(ids: string[] | null, refreshMs?: number): AsyncState<O.Deal[]> {
  const key = ids ? ids.join(",") : "";
  return useRead(
    async (client) => {
      if (!ids || ids.length === 0) return [];
      return O.getDeals(client, ids);
    },
    key,
    { refreshMs },
  );
}

export function useDeal(id: string | null, refreshMs?: number): AsyncState<O.Deal> {
  return useRead(
    (client) =>
      id
        ? O.getDeal(client, id)
        : Promise.resolve(null as unknown as O.Deal),
    id ?? "",
    { refreshMs },
  );
}

export function useTerms(id: string | null): AsyncState<O.DealTerms> {
  return useRead(
    (client) =>
      id
        ? O.getTerms(client, id)
        : Promise.resolve(null as unknown as O.DealTerms),
    id ?? "",
  );
}

export function useMonitorLog(id: string | null): AsyncState<O.MonitorLog> {
  return useRead(
    (client) =>
      id
        ? O.getMonitorLog(client, id)
        : Promise.resolve([] as O.MonitorLog),
    id ?? "",
  );
}

export function usePayouts(id: string | null, refreshMs?: number): AsyncState<O.PayoutInfo> {
  return useRead(
    (client) =>
      id
        ? O.getPayouts(client, id)
        : Promise.resolve(null as unknown as O.PayoutInfo),
    id ?? "",
    { refreshMs },
  );
}

export function useAudit(id: string | null, refreshMs?: number): AsyncState<O.DealAudit> {
  return useRead(
    (client) =>
      id
        ? O.getAudit(client, id)
        : Promise.resolve(null as unknown as O.DealAudit),
    id ?? "",
    { refreshMs },
  );
}

export function useLog(id: string | null, count = 120): AsyncState<O.LogEntry[]> {
  return useRead(
    async (client) => {
      if (!id) return [] as O.LogEntry[];
      const rows = await O.getLog(client, 0, count);
      return rows.filter((row) => !row.id || row.id === id);
    },
    id ?? "",
  );
}
