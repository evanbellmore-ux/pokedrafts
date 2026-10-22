"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `refresh` every `intervalMs` while the tab is visible, and once on
 * coming back to a tab whose last refresh is older than that. Watch pages
 * have no realtime channel (a signed-out visitor cannot subscribe to the
 * league's tables), so they poll.
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number) {
  const refreshRef = useRef(refresh);
  const lastRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    lastRef.current = Date.now();
    const run = () => {
      lastRef.current = Date.now();
      refreshRef.current();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRef.current >= intervalMs) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
