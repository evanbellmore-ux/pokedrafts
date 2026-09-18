"use client";

import { useCallback, useSyncExternalStore } from "react";

// Keep the desktop shell breakpoint in calculator.module.css in sync.
const QUERY = "(min-width: 80rem)";

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useDesktopRosterLayout(beforeChange?: () => void): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(QUERY);
    const change = () => {
      // Capture focus before React relocates the controlled roster pickers.
      beforeChange?.();
      onChange();
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [beforeChange]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
