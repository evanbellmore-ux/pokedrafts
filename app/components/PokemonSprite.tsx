"use client";

import { useEffect, useState } from "react";
import {
  fetchPokeApiSprite,
  getSpriteUrl,
  loadDex,
  normalizePokemonName,
} from "@/app/lib/pokemon";

export type SpriteSize = "sm" | "md" | "card" | "lg" | "fill";

const SIZE_PX: Record<SpriteSize, number> = { sm: 32, md: 40, card: 48, lg: 64, fill: 48 };
const SIZE_CLASS: Record<SpriteSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  // A Pokémon's card in the calculator and Training.
  card: "h-12 w-12",
  lg: "h-16 w-16",
  // Fills a sized parent, e.g. a roster slot.
  fill: "h-full w-full",
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
  /** No tile behind the sprite: the parent draws the frame (roster slots). */
  bare?: boolean;
  /**
   * A known image URL, used as is: no dex lookup and no PokéAPI fallback.
   * For signed-out pages (the landing preview), where the dex is not readable,
   * and the calculator's and Training's slots (app/lib/battle/sprites.ts).
   * null: known to have none, so the placeholder shows without a lookup.
   */
  src?: string | null;
  /** The name is shown beside it: the image has no text (alt=""), the placeholder no label. */
  decorative?: boolean;
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
  bare = false,
  src,
  decorative = false,
}: PokemonSpriteProps) {
  const key = normalizePokemonName(name);
  // A given src stands for its own picture: a new one starts over, as a new name does.
  const identity = src === undefined ? key : `${key} ${src ?? ""}`;
  const start = (): SpriteState =>
    src ? { key: identity, status: "ready", url: src }
      : src === null ? { key: identity, status: "failed" } : initialState(name);
  const [state, setState] = useState<SpriteState>(start);

  // Reset when the name or src changes (derived state during render, not an effect).
  if (state.key !== identity) {
    setState(start());
  }

  useEffect(() => {
    if (src !== undefined || state.status !== "loading") return;
    let active = true;

    void resolveSprite(name).then((url) => {
      if (!active) return;
      setState(url ? { key, status: "ready", url } : { key, status: "failed" });
    });

    return () => {
      active = false;
    };
  }, [key, name, src, state.status]);

  const px = SIZE_PX[size];
  const box = `${SIZE_CLASS[size]} shrink-0 ${bare ? "rounded-full" : "rounded-md"} ${className}`.trim();

  if (state.status === "loading") {
    return (
      <div
        aria-hidden="true"
        className={`${box} animate-pulse bg-panel-hover`}
      />
    );
  }

  if (state.status === "failed") {
    const label = decorative
      ? { "aria-hidden": true }
      : { role: "img", "aria-label": `${name} (no sprite available)`, title: name };
    return (
      <div
        {...label}
        className={`${box} flex items-center justify-center ${bare ? "text-xs" : "bg-panel-hover text-sm"} font-bold uppercase text-muted`}
      >
        {name.trim().charAt(0) || "?"}
      </div>
    );
  }

  // Game sprites carry wide transparent margins, so they fill a tile without
  // padding; the official artwork (used when a form has no game sprite) runs
  // edge to edge and keeps it.
  const tile = state.url.includes("/official-artwork/") ? "bg-panel-hover p-1" : "bg-panel-hover";

  return (
    // eslint-disable-next-line @next/next/no-img-element -- sprites come from Supabase storage / PokeAPI and are tiny; the image optimizer adds nothing.
    <img
      src={state.url}
      alt={decorative ? "" : name}
      title={decorative ? undefined : name}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => {
        // A given src is not the dex's answer, so it never poisons the cache.
        if (src === undefined) spriteCache.set(key, null);
        setState({ key: identity, status: "failed" });
      }}
      className={`${box} object-contain ${bare ? "" : tile}`.trim()}
    />
  );
}
