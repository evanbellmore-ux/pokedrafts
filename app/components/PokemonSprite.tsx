"use client";

import { useEffect, useState } from "react";
import {
  fetchPokeApiSprite,
  getSpriteUrl,
  loadDex,
  normalizePokemonName,
} from "@/app/lib/pokemon";

export type SpriteSize = "sm" | "md" | "lg";

const SIZE_PX: Record<SpriteSize, number> = { sm: 32, md: 40, lg: 64 };
const SIZE_CLASS: Record<SpriteSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

/** normalized name -> url, or null when every source failed (negative cache). */
const spriteCache = new Map<string, string | null>();
/** normalized name -> pending lookup, so concurrent mounts share one request. */
const inFlight = new Map<string, Promise<string | null>>();

async function resolveSprite(name: string): Promise<string | null> {
  const key = normalizePokemonName(name);
  const cached = spriteCache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    let url: string | null = null;

    try {
      url = getSpriteUrl(name, await loadDex());
    } catch {
      url = null;
    }

    if (!url) {
      try {
        url = await fetchPokeApiSprite(name);
      } catch {
        url = null;
      }
    }

    spriteCache.set(key, url);
    return url;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

type SpriteState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; url: string }
  | { key: string; status: "failed" };

function initialState(name: string): SpriteState {
  const key = normalizePokemonName(name);
  const cached = spriteCache.get(key);
  if (cached === undefined) return { key, status: "loading" };
  return cached ? { key, status: "ready", url: cached } : { key, status: "failed" };
}

export type PokemonSpriteProps = {
  name: string;
  size?: SpriteSize;
  className?: string;
};

/**
 * Sprite with three states: loading (pulsing tile), ready (<img> with fixed
 * width/height) and failed (placeholder tile showing the first letter).
 * Broken image URLs flip to failed via onError and are remembered.
 */
export default function PokemonSprite({
  name,
  size = "md",
  className = "",
}: PokemonSpriteProps) {
  const key = normalizePokemonName(name);
  const [state, setState] = useState<SpriteState>(() => initialState(name));

  // Reset when the name changes (derived state during render, not an effect).
  if (state.key !== key) {
    setState(initialState(name));
  }

  useEffect(() => {
    if (state.status !== "loading") return;
    let active = true;

    void resolveSprite(name).then((url) => {
      if (!active) return;
      setState(url ? { key, status: "ready", url } : { key, status: "failed" });
    });

    return () => {
      active = false;
    };
  }, [key, name, state.status]);

  const px = SIZE_PX[size];
  const box = `${SIZE_CLASS[size]} shrink-0 rounded-md ${className}`.trim();

  if (state.status === "loading") {
    return (
      <div
        aria-hidden="true"
        className={`${box} animate-pulse bg-panel-hover`}
      />
    );
  }

  if (state.status === "failed") {
    return (
      <div
        role="img"
        aria-label={`${name} (no sprite available)`}
        title={name}
        className={`${box} flex items-center justify-center bg-panel-hover text-sm font-bold uppercase text-muted`}
      >
        {name.trim().charAt(0) || "?"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- sprites come from Supabase storage / PokeAPI and are tiny; the image optimizer adds nothing.
    <img
      src={state.url}
      alt={name}
      title={name}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => {
        spriteCache.set(key, null);
        setState({ key, status: "failed" });
      }}
      className={`${box} bg-panel-hover object-contain p-1`}
    />
  );
}
