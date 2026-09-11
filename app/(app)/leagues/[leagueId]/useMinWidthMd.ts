"use client";

import { useSyncExternalStore } from "react";

/** Tailwind 4's `md` breakpoint. */
const QUERY = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/**
 * True from the `md` breakpoint up. Pages with wide tables render the table
 * here and card rows below it (docs/release-architecture.md section 8.5),
 * so a 2000-entry pool is never laid out twice. Server rendering and
 * hydration report false; the client corrects itself right after.
 */
export function useMinWidthMd(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
