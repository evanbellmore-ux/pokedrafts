import type { NameParts } from "@/app/lib/battle/doubles-types";

/**
 * A card heading's Pokémon name: the name and its number visible ("Garchomp (1)"), the side word for screen readers only,
 * since each card sits in its labelled side group: "Garchomp", "Garchomp<sr-only> (yours)</sr-only>", "Garchomp (1)",
 * "Garchomp (<sr-only>yours, </sr-only>1)". Nothing for an empty base.
 */
export default function PokemonName({ parts }: { parts: NameParts }) {
  const { base, side, number } = parts;
  if (!base) return <></>;
  if (number === null) return <>{base}{side && <span className="sr-only"> ({side})</span>}</>;
  if (!side) return <>{`${base} (${number})`}</>;
  return <>{`${base} (`}<span className="sr-only">{`${side}, `}</span>{`${number})`}</>;
}
