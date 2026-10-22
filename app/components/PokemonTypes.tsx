"use client";

import TypeBadge from "@/app/components/TypeBadge";
import { getPokemonTypes, type PokemonTypes as Types } from "@/app/lib/pokemon";
import { useDex } from "@/app/lib/pokemon/useDex";

export type PokemonTypesProps = {
  name: string;
  /** Skip the lookup and render these types directly. */
  types?: Types | null;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Renders one or two TypeBadges for a Pokémon, resolving types through the
 * override table and the shared dex. Renders nothing while the dex loads or
 * when the types are unknown, so layouts never shift for missing data. With
 * `types` the dex is not loaded at all, which keeps a signed-out page (the
 * public watch page) from asking for a dex it may not read.
 */
export default function PokemonTypes({ name, types, size = "sm", className = "" }: PokemonTypesProps) {
  if (types?.type1) return <TypeList types={types} size={size} className={className} />;
  return <LookedUpTypes name={name} size={size} className={className} />;
}

function LookedUpTypes({ name, size, className }: { name: string; size: "sm" | "md"; className: string }) {
  const { dex } = useDex();
  const resolved = getPokemonTypes(name, dex);
  if (!resolved?.type1) return null;
  return <TypeList types={resolved} size={size} className={className} />;
}

function TypeList({ types, size, className }: { types: Types; size: "sm" | "md"; className: string }) {
  if (!types.type1) return null;
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 ${className}`.trim()}
      aria-label={`Types: ${[types.type1, types.type2].filter(Boolean).join(", ")}`}
    >
      <TypeBadge type={types.type1} size={size} />
      {types.type2 && <TypeBadge type={types.type2} size={size} />}
    </span>
  );
}
