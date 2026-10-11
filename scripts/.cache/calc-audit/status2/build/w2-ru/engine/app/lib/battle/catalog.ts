import data from "@/data/champions/catalog.json";
import type { ChampionsCatalog } from "./types";

/** Generated and validated offline; no Supabase or live dex lookup is needed. */
export const champions = data as ChampionsCatalog;
export const speciesById = new Map(champions.species.map((species) => [species.id, species]));
export const movesById = new Map(champions.moves.map((move) => [move.id, move]));
export const abilitiesById = new Map(champions.abilities.map((ability) => [ability.id, ability]));
export const itemsById = new Map(champions.items.map((item) => [item.id, item]));
