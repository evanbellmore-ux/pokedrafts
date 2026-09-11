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
 * when the types are unknown, so layouts never shift for missing data.
 */
export default function PokemonTypes({
  name,
  types,
  size = "sm",
  className = "",
}: PokemonTypesProps) {
  const { dex } = useDex();
  const resolved = types ?? getPokemonTypes(name, dex);

  if (!resolved?.type1) return null;

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 ${className}`.trim()}
      aria-label={`Types: ${[resolved.type1, resolved.type2]
        .filter(Boolean)
        .join(", ")}`}
    >
      <TypeBadge type={resolved.type1} size={size} />
      {resolved.type2 && <TypeBadge type={resolved.type2} size={size} />}
    </span>
  );
}
