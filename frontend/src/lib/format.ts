export const ATTO = 10n ** 18n;

/** Render an atto amount as GEN, trimming trailing zeros. Precision-safe for bigints. */
export function formatGen(atto: string | bigint, decimals = 4): string {
  const value = BigInt(atto);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ATTO;
  const frac = abs % ATTO;
  const fracStr = frac
    .toString()
    .padStart(18, "0")
    .slice(0, decimals)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

export function gen(wholeOrDecimal: string | number): bigint {
  const text = String(wholeOrDecimal).trim();
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * ATTO + BigInt(padded || "0");
}

export function shortAddress(address?: string, size = 4): string {
  if (!address) return "";
  const clean = address.trim();
  if (clean.length <= size * 2 + 2) return clean;
  return `${clean.slice(0, size + 2)}…${clean.slice(-size)}`;
}

export function shortDigest(digest?: string, size = 6): string {
  if (!digest) return "—";
  if (digest.length <= size * 2 + 2) return digest;
  return `${digest.slice(0, size + 2)}…${digest.slice(-size)}`;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function formatUnix(seconds: number | string): string {
  const value = Number(seconds);
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "in 3h" / "12m ago" — coarse, for deadlines and windows. */
export function relativeTime(seconds: number | string, now = Date.now() / 1000): string {
  const target = Number(seconds);
  if (!target) return "—";
  const delta = target - now;
  const abs = Math.abs(delta);
  const unit =
    abs < 60
      ? ["s", 1]
      : abs < 3600
        ? ["m", 60]
        : abs < 86400
          ? ["h", 3600]
          : ["d", 86400];
  const amount = Math.round(abs / (unit[1] as number));
  return delta >= 0 ? `in ${amount}${unit[0]}` : `${amount}${unit[0]} ago`;
}

/** "02:11:09" — exact countdown, for windows that are about to close. */
export function countdown(seconds: number | string, now = Date.now() / 1000): string {
  const target = Number(seconds);
  if (!target) return "—";
  const delta = Math.max(0, Math.floor(target - now));
  const hours = Math.floor(delta / 3600);
  const minutes = Math.floor((delta % 3600) / 60);
  const secs = delta % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    secs,
  ).padStart(2, "0")}`;
}

export function formatDuration(seconds: number | string): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 60) return `${value}s`;
  if (value < 3600) {
    const minutes = value / 60;
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}m`;
  }
  if (value < 86400) {
    const hours = value / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }
  const days = value / 86400;
  return `${Number.isInteger(days) ? days : days.toFixed(1)}d`;
}

export function bpsToPercent(bps: number | string, decimals = 2): string {
  const value = Number(bps);
  const percent = value / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function percentToBps(percent: string | number): number {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10000, Math.max(0, Math.round(value)));
}
