"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Trails `value` by `delay` ms so sprite and type lookups skip half-typed names. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * True when the media query matches. The server snapshot is `false`, so the
 * mobile layout is what gets server-rendered and hydrated; React re-renders
 * with the real value before the first paint on wider screens.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
