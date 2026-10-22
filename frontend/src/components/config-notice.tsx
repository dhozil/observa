import { isConfigured } from "@/lib/observa";

export function ConfigNotice({ className }: { className?: string }) {
  if (isConfigured) return null;
  return (
    <div className={`border-l-2 border-watch bg-watch/[0.06] px-4 py-3 ${className ?? ""}`}>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-watch-bright">
        Setup required
      </p>
      <p className="mt-1.5 text-[0.8rem] leading-relaxed text-mist-dim">
        No contract address configured. Deploy Observa, then set{" "}
        <code className="border-b border-line font-mono text-[0.72rem] text-mist">
          NEXT_PUBLIC_OBSERVA_ADDRESS
        </code>{" "}
        in{" "}
        <code className="border-b border-line font-mono text-[0.72rem] text-mist">
          frontend/.env.local
        </code>{" "}
        and restart the server.
      </p>
    </div>
  );
}
