"use client";

import * as React from "react";

/** Unix seconds, ticking so countdowns and probe windows stay live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
