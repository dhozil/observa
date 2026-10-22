import { SignalField3D } from "@/components/signal-field-3d";

export function SiteBackground() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 -z-20 opacity-[0.72]" aria-hidden>
        <SignalField3D />
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_85%_55%_at_50%_-5%,rgba(169,214,194,0.055),transparent_58%),linear-gradient(180deg,rgba(7,9,10,0.32)_0%,rgba(7,9,10,0.08)_38%,rgba(7,9,10,0.62)_100%)]"
      />
      <div
        aria-hidden
        className="telemetry-grid pointer-events-none fixed inset-0 -z-10 opacity-[0.28] mask-fade-b"
      />
      <div aria-hidden className="grain pointer-events-none fixed inset-0 z-50" />
    </>
  );
}
