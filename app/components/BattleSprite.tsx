import { battleSpriteUrl } from "@/app/lib/battle/sprites";
import PokemonSprite, { type SpriteSize } from "./PokemonSprite";

/**
 * A battle catalog species' sprite in a calculator or Training slot, from the bundled table (app/lib/battle/sprites.ts):
 * never a dex or PokeAPI lookup. Decorative, as the slot names its Pokémon beside it; `name` (the species' name) gives
 * the placeholder its letter when the image cannot load. A fainted Pokémon's sprite is faded and grey.
 */
export default function BattleSprite({ speciesId, name, size = "md", fainted = false }: {
  speciesId: string;
  name: string;
  size?: SpriteSize;
  fainted?: boolean;
}) {
  return <PokemonSprite name={name} src={battleSpriteUrl(speciesId)} size={size} className={fainted ? "opacity-50 grayscale" : ""} decorative />;
}
