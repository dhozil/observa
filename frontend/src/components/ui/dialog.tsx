"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-void/85 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-md rounded-none border border-line bg-panel",
          className,
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -left-px -top-px size-2.5 border-l border-t border-mist/40"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-px -top-px size-2.5 border-r border-t border-mist/40"
        />
        {(title || description) && (
          <div className="border-b border-line-soft px-5 py-4">
            {title ? <h2 className="text-2xl leading-none">{title}</h2> : null}
            {description ? (
              <p className="mt-2 text-[0.78rem] leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
        )}
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center text-muted transition-colors hover:text-mist"
        >
          <X className="size-4" />
        </button>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
