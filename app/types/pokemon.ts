/**
 * The Pokémon dataset and the rules a draft format can be built from
 * (docs/release-architecture.md section 13).
 *
 * - `PokemonEntry` mirrors one row of `public.pokemon` (13.4).
 * - `Preset` mirrors one entry of `data/pokemon/regulations.json` (13.6).
 * - `FormatRules` is the `rules` object saved inside `draft_formats.json`
 *   (13.5), next to `version`, `leagueName` and `pokemon`.
 */

/** A game key the dataset knows availability for (13.4). */
export type GameKey =
  | "champions"
  | "scarlet_violet"
  | "legends_za"
  | "sword_shield"
  | "legends_arceus"
  | "bdsp"
  | "lets_go"
  | "ultra_sun_ultra_moon"
  | "sun_moon"
  | "oras"
  | "x_y"
  | "black_2_white_2"
  | "black_white"
  | "heartgold_soulsilver"
  | "platinum"
  | "diamond_pearl"
  | "emerald"
  | "firered_leafgreen"
  | "ruby_sapphire"
  | "crystal"
  | "gold_silver"
  | "yellow"
  | "red_blue";

/** The row's relation to its species. `default` is the species itself. */
export type FormKind = "default" | "mega" | "regional" | "gender" | "other";

/** A category tag on a row; forms inherit their species' tags. */
export type TagKey =
  | "legendary"
  | "sub_legendary"
  | "restricted"
  | "mythical"
  | "paradox"
  | "ultra_beast";

export type StatKey =
  | "hp"
  | "attack"
  | "defense"
  | "special_attack"
  | "special_defense"
  | "speed";

/** One row of `public.pokemon`. `tags` and `games` are open string lists. */
export type PokemonEntry = {
  /** PokéAPI pokemon id, stable. */
  id: number;
  /** National dex number. */
  species_id: number;
  /** PokéAPI pokemon name, e.g. "charizard-mega-x". */
  slug: string;
  /** App convention, e.g. "Mega Charizard X". */
  display_name: string;
  /** "Charizard". */
  species_name: string;
  form_kind: FormKind;
  /** "Mega X", "Alolan", "Wash", "Female"; null for the default form. */
  form_label: string | null;
  /** Capitalised app spelling ("Fire", "Flying"). */
  type1: string;
  type2: string | null;
  hp: number;
  attack: number;
  defense: number;
  special_attack: number;
  special_defense: number;
  speed: number;
  /** Sum of the six base stats. */
  bst: number;
  generation: number;
  tags: string[];
  games: string[];
  /** Entry numbers per Pokédex for the species, e.g. { paldea: 12 }. */
  dex_numbers: Record<string, number>;
  sprite_url: string | null;
  updated_at: string | null;
};

/** A regulation that lists exactly which dataset rows are eligible. */
export type RosterRule = { kind: "roster"; slugs: string[] };

/** A regulation expressed as Pokédex membership and excluded categories. */
export type FilterRule = {
  kind: "filter";
  /** Pokédex keys the species must belong to; null = every row in the game. */
  dexes: string[] | null;
  /** Inclusive entry-number ranges per Pokédex, e.g. { paldea: [[1, 375]] }. */
  dexRanges: Record<string, [number, number][]> | null;
  excludeTags: string[];
  /** Informational: how many restricted Pokémon a team may carry. */
  restrictedPerTeam: number;
};

export type PresetRule = RosterRule | FilterRule;

/** One entry of `data/pokemon/regulations.json`. */
export type Preset = {
  key: string;
  game: string;
  name: string;
  /** ISO date. */
  starts: string;
  /** ISO date, or null while the regulation is current. */
  ends: string | null;
  source: string;
  rule: PresetRule;
  notes?: string;
};

export type RulesSource = { kind: "games"; games: GameKey[] } | { kind: "all" };

/** Form kinds the builder can toggle; `default` rows are always included. */
export type FormToggleKind = Exclude<FormKind, "default">;

export type RulesFilters = {
  bst: { min: number | null; max: number | null };
  /** Per-stat maximums; null = no limit. */
  stats: Record<StatKey, number | null>;
  generation: { min: number | null; max: number | null };
  /** Empty = any; otherwise the row's type1 or type2 must be listed. */
  types: string[];
  /** Rows carrying any of these tags are dropped. */
  excludeTags: string[];
  forms: Record<FormToggleKind, boolean>;
};

export type RulesPricing =
  | {
      mode: "bands";
      /** Exactly 20 descending integers; entry i is the minimum total for 20 - i points. */
      bands: number[];
    }
  | { mode: "manual" };

/** The saved recipe of a format (13.5). */
export type FormatRules = {
  version: string;
  source: RulesSource;
  /** Preset key, or null for none. */
  preset: string | null;
  filters: RulesFilters;
  pricing: RulesPricing;
};
