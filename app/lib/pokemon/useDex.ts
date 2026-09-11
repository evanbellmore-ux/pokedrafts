"use client";

import { useEffect, useState } from "react";
import { friendlyError } from "@/app/lib/errors";
import { getCachedDex, loadDex, type DexMap } from "@/app/lib/pokemon";

export type DexState = {
  dex: DexMap | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Loads the Pokémon dex once per session and exposes it to components.
 * The module cache makes subsequent mounts synchronous.
 */
export function useDex(): DexState {
  const [dex, setDex] = useState<DexMap | null>(getCachedDex);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (dex) return;
    let active = true;

    loadDex()
      .then((map) => {
        if (active) setDex(map);
      })
      .catch((caught) => {
        if (active) setError(friendlyError(caught));
      });

    return () => {
      active = false;
    };
  }, [dex, attempt]);

  return {
    dex,
    loading: !dex && !error,
    error,
    retry: () => {
      setError(null);
      setAttempt((current) => current + 1);
    },
  };
}
