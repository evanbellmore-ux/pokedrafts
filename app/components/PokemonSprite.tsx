"use client";

import { useEffect, useState } from "react";
import {
  getPokeApiSprite,
  loadLocalSpriteMap,
  normalizePokemonName,
} from "@/app/lib/pokemon/sprites";

type Props = {
  name: string;
  size?: "sm" | "md";
};

let cachedSpriteMapPromise: Promise<Record<string, string>> | null = null;
let cachedSpriteMap: Record<string, string> | null = null;
const apiSpriteCache: Record<string, string> = {};

export default function PokemonSprite({ name, size = "md" }: Props) {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSprite() {
      const normalized = normalizePokemonName(name);

      if (cachedSpriteMap?.[normalized]) {
        setSpriteUrl(cachedSpriteMap[normalized]);
        return;
      }

      if (apiSpriteCache[normalized]) {
        setSpriteUrl(apiSpriteCache[normalized]);
        return;
      }

      if (!cachedSpriteMapPromise) {
        cachedSpriteMapPromise = loadLocalSpriteMap();
      }

      cachedSpriteMap = await cachedSpriteMapPromise;

      const localSprite = cachedSpriteMap[normalized];

      if (localSprite) {
        if (active) setSpriteUrl(localSprite);
        return;
      }

      const apiSprite = await getPokeApiSprite(name);

      if (apiSprite) {
        apiSpriteCache[normalized] = apiSprite;
        if (active) setSpriteUrl(apiSprite);
      }
    }

    setSpriteUrl(null);
    loadSprite();

    return () => {
      active = false;
    };
  }, [name]);

  const sizeClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";

  if (!spriteUrl) {
    return (
      <div
        className={`${sizeClass} animate-pulse rounded-md bg-zinc-800/60`}
        aria-label={`Loading sprite for ${name}`}
      />
    );
  }

  return (
    <img
      src={spriteUrl}
      alt={name}
      className={`${sizeClass} rounded-md bg-zinc-800 object-contain p-1`}
      loading="lazy"
    />
  );
}