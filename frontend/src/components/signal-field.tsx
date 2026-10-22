"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The watch made visible: three slow signal traces over an instrument grid,
 * with a scan line sweeping across and occasional dropouts. It is drawn on a
 * canvas rather than shipped as a stock video, so it stays crisp, weighs
 * nothing, and is actually about the subject.
 */
export function SignalField({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let width = 0;
    let height = 0;
    const started = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const trace = (
      t: number,
      amp: number,
      freq: number,
      speed: number,
      phase: number,
      color: string,
    ) => {
      const center = height * 0.52;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const wave =
          Math.sin(x * freq + t * speed + phase) * amp +
          Math.sin(x * freq * 0.37 - t * speed * 0.55 + phase * 1.7) * amp * 0.45;
        const y = center + wave;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const draw = (now: number) => {
      const t = reduced ? 8 : (now - started) / 1000;
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(125, 145, 157, 0.075)";
      for (let x = 0; x < width; x += 52) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 52) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }

      trace(t, 26, 0.011, 0.5, 0, "rgba(63, 227, 193, 0.23)");
      trace(t, 17, 0.017, 0.32, 2.1, "rgba(63, 227, 193, 0.13)");
      trace(t, 34, 0.007, 0.22, 4.4, "rgba(243, 180, 86, 0.10)");

      // A signal-loss dropout, drawn as a brief flat zero on the main trace.
      const dropout = (t * 0.09) % 1.6 - 0.3;
      const dropX = dropout * width;
      if (dropX > 0 && dropX < width) {
        const y = height * 0.52;
        const gradient = ctx.createLinearGradient(dropX - 60, 0, dropX + 60, 0);
        gradient.addColorStop(0, "rgba(255, 95, 110, 0)");
        gradient.addColorStop(0.5, "rgba(255, 95, 110, 0.32)");
        gradient.addColorStop(1, "rgba(255, 95, 110, 0)");
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(dropX - 60, y);
        ctx.lineTo(dropX + 60, y);
        ctx.stroke();
      }

      // The sweep: a soft leading edge with a trailing wash.
      const scanX = (((t * 0.075) % 1.25) - 0.12) * width;
      const wash = ctx.createLinearGradient(scanX - 140, 0, scanX, 0);
      wash.addColorStop(0, "rgba(63, 227, 193, 0)");
      wash.addColorStop(1, "rgba(63, 227, 193, 0.055)");
      ctx.fillStyle = wash;
      ctx.fillRect(scanX - 140, 0, 140, height);

      ctx.strokeStyle = "rgba(63, 227, 193, 0.28)";
      ctx.beginPath();
      ctx.moveTo(scanX, 0);
      ctx.lineTo(scanX, height);
      ctx.stroke();

      raf = window.requestAnimationFrame(draw);
    };

    resize();
    raf = window.requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn("block h-full w-full", className)}
    />
  );
}
