import { normalizePokemonName, toPokeApiSlug } from "@/app/lib/pokemon";
import { resolveRuntimeSpecies, type BattleRuntime } from "./runtime";
import { normalizeAlias, type SpeciesResolution } from "./species-identity";

/**
 * League rosters store Pool Builder display names (`display_name` in
 * data/pokemon/pokemon.json, docs/release-architecture.md 13.4), not Showdown
 * names. The catalog aliases already cover most of them ("Rotom (Wash)",
 * "Alolan Raichu", "Mega Charizard X", "Indeedee (Female)"). This table covers
 * the rest, each mapped to its exact Showdown species id:
 *
 * - Pool Builder form labels worded differently from Showdown's forme names
 *   ("(Blaze Breed)" for Blaze, "(Shadow Rider)" for Shadow, "(Own Tempo)" for
 *   Dusk, "Mega Meowstic" for the male Mega, "Primal Groudon" for Groudon-Primal).
 * - PokéAPI default forms that the same plain name means differently in
 *   Showdown: the Pool Builder's "Minior" is the Meteor Form (Showdown's plain
 *   Minior is a Core), and its "Maushold" is Family of Four (Showdown's plain
 *   Maushold is Family of Three, 2.3 kg instead of 2.8 kg).
 * - Rows defined by an ability rather than a form: the Power Construct Zygarde
 *   rows carry that ability, which a fresh roster build then uses, and the
 *   default 50% row carries Aura Break (PokéAPI's zygarde-50), so it stays
 *   apart from them where the usual ability is Power Construct (a native
 *   game's Random Battle Zygarde).
 *
 * This is not fuzzy matching. tests/unit/calculator-roster-identity.test.ts
 * derives each Pool Builder row's exact form from its PokéAPI slug, checks the
 * resolved form's stats and types against the row, and runs in the unit suite
 * (npm test, npm run check), so a new Pool Builder name the calculator cannot
 * match fails it. An entry whose form is absent from the selected game is
 * unavailable there rather than falling back to a same-named base form. Only
 * league rosters use this table; PokéPaste imports keep Showdown's own names,
 * where plain "Minior" and "Maushold" keep Showdown's meaning.
 */
export type RosterAlias = string | { readonly speciesId: string; readonly abilityId: string };

export const POOL_BUILDER_ROSTER_ALIASES: Readonly<Record<string, RosterAlias>> = {
  "Calyrex (Ice Rider)": "calyrexice",
  "Calyrex (Shadow Rider)": "calyrexshadow",
  "Floette (Eternal Flower)": "floetteeternal",
  "Greninja (Battle Bond)": "greninjabond",
  "Maushold": "mausholdfour",
  "Mega Meowstic": "meowsticmmega",
  "Minior": "miniormeteor",
  "Minior (Core)": "minior",
  "Ogerpon (Cornerstone Mask)": "ogerponcornerstone",
  "Ogerpon (Hearthflame Mask)": "ogerponhearthflame",
  "Ogerpon (Wellspring Mask)": "ogerponwellspring",
  "Paldean Tauros (Aqua Breed)": "taurospaldeaaqua",
  "Paldean Tauros (Blaze Breed)": "taurospaldeablaze",
  "Paldean Tauros (Combat Breed)": "taurospaldeacombat",
  "Primal Groudon": "groudonprimal",
  "Primal Kyogre": "kyogreprimal",
  "Rockruff (Own Tempo)": "rockruffdusk",
  "Squawkabilly (Yellow Plumage)": "squawkabillyyellow",
  "Zacian (Crowned Sword)": "zaciancrowned",
  "Zamazenta (Crowned Shield)": "zamazentacrowned",
  "Zygarde": { speciesId: "zygarde", abilityId: "aurabreak" },
  "Zygarde (10% Power Construct)": { speciesId: "zygarde10", abilityId: "powerconstruct" },
  "Zygarde (50% Power Construct)": { speciesId: "zygarde", abilityId: "powerconstruct" },
};

/**
 * Spellings stored before the Pool Builder's current display names, which the
 * Pool Builder itself still treats as one specific row: plain "Paldean Tauros" is
 * the Combat Breed (docs/release-architecture.md 13.4, SPECIAL_SLUGS in
 * app/lib/pokemon/index.ts). Other hand-typed spellings need manual selection.
 */
export const LEGACY_ROSTER_ALIASES: Readonly<Record<string, RosterAlias>> = {
  "Paldean Tauros": "taurospaldeacombat",
  "Tauros-Paldea": "taurospaldeacombat",
};

/**
 * The Pool Builder also finds a typed name by its PokéAPI slug (toPokeApiSlug, as indexDataset in
 * app/lib/pokemon/dataset.ts does), so rosters can hold other spellings of its rows:
 * "Ninetales-Alolan", "Meowstic (Male)", "Tauros-Paldea-Blaze-Breed" or the slug itself. A slug that
 * names its form the same way Showdown does resolves directly; these are the rows whose slug does not
 * (mostly PokéAPI's default forms), each mapped to that row's display name in data/pokemon/pokemon.json.
 * tests/unit/calculator-roster-identity.test.ts checks every Pool Builder row's slug resolves like its
 * display name in every game.
 */
export const POOL_BUILDER_SLUG_NAMES: Readonly<Record<string, string>> = {
  "basculegion-male": "Basculegion",
  "basculin-red-striped": "Basculin",
  "darmanitan-galar-standard": "Galarian Darmanitan",
  "darmanitan-standard": "Darmanitan",
  "deoxys-normal": "Deoxys",
  "dudunsparce-two-segment": "Dudunsparce",
  "eiscue-ice": "Eiscue",
  "enamorus-incarnate": "Enamorus",
  "frillish-male": "Frillish",
  "giratina-altered": "Giratina",
  "gourgeist-average": "Gourgeist",
  "indeedee-male": "Indeedee",
  "jellicent-male": "Jellicent",
  "keldeo-ordinary": "Keldeo",
  "landorus-incarnate": "Landorus",
  "lycanroc-midday": "Lycanroc",
  "maushold-family-of-four": "Maushold",
  "meloetta-aria": "Meloetta",
  "meowstic-male": "Meowstic",
  "mimikyu-disguised": "Mimikyu",
  "minior-red": "Minior (Core)",
  "minior-red-meteor": "Minior",
  "morpeko-full-belly": "Morpeko",
  "necrozma-dawn": "Necrozma (Dawn Wings)",
  "necrozma-dusk": "Necrozma (Dusk Mane)",
  "oinkologne-male": "Oinkologne",
  "oricorio-baile": "Oricorio",
  "palafin-zero": "Palafin",
  "pumpkaboo-average": "Pumpkaboo",
  "pyroar-male": "Pyroar",
  "shaymin-land": "Shaymin",
  "squawkabilly-green-plumage": "Squawkabilly",
  "tatsugiri-curly": "Tatsugiri",
  "tauros-paldea-aqua-breed": "Paldean Tauros (Aqua Breed)",
  "tauros-paldea-blaze-breed": "Paldean Tauros (Blaze Breed)",
  "tauros-paldea-combat-breed": "Paldean Tauros (Combat Breed)",
  "thundurus-incarnate": "Thundurus",
  "tornadus-incarnate": "Tornadus",
  "toxtricity-amped": "Toxtricity",
  "urshifu-single-strike": "Urshifu",
  "wishiwashi-solo": "Wishiwashi",
  "wormadam-plant": "Wormadam",
  "zygarde-10-power-construct": "Zygarde (10% Power Construct)",
  "zygarde-50": "Zygarde",
  "zygarde-50-power-construct": "Zygarde (50% Power Construct)",
};

/** The same table by the Pool Builder's name key, so a slug typed without separators ("MeowsticMale") matches too. */
const SLUG_NAMES_BY_KEY = new Map(Object.entries(POOL_BUILDER_SLUG_NAMES).map(([slug, name]) => [normalizePokemonName(slug), name]));

export type RosterResolution =
  | { status: "resolved"; speciesId: string; abilityId?: string }
  | { status: "unavailable" | "ambiguous"; reason: string };

const aliases = new Map(Object.entries({ ...LEGACY_ROSTER_ALIASES, ...POOL_BUILDER_ROSTER_ALIASES })
  .map(([name, alias]) => [normalizeAlias(name), typeof alias === "string" ? { speciesId: alias } : alias] as const));

/**
 * Resolve a league roster name: the Pool Builder table first, then exact catalog aliases, then the
 * other spellings the Pool Builder accepts for the same row (its PokéAPI slug rule).
 */
export function resolveRosterName(runtime: BattleRuntime, name: string): RosterResolution {
  const exact = resolveDisplayName(runtime, name);
  // A name the tables give a form keeps meaning that form, even in a game without it.
  if (exact.status !== "unavailable" || aliases.has(normalizeAlias(name))) return exact;
  const slug = toPokeApiSlug(name);
  // A slug the tables name (such as "minior" typed with a stray backtick) keeps the tables' meaning.
  const viaSlug = resolveDisplayName(runtime, POOL_BUILDER_SLUG_NAMES[slug] ?? SLUG_NAMES_BY_KEY.get(normalizePokemonName(name)) ?? slug);
  if (viaSlug.status === "resolved") return viaSlug;
  // A gender word typed without separators ("MeowsticFemale", "MeowsticFemaleMega"), as the Pool Builder reads it.
  const gendered = normalizePokemonName(name).match(/^(.+?)(female|male)(mega)?$/);
  const viaGender = gendered ? resolveDisplayName(runtime, `${gendered[1]}-${gendered[2]}${gendered[3] ? "-mega" : ""}`) : null;
  return viaGender?.status === "resolved" ? viaGender : exact;
}

function resolveDisplayName(runtime: BattleRuntime, name: string): RosterResolution {
  const alias: { speciesId: string; abilityId?: string } | undefined = aliases.get(normalizeAlias(name));
  if (alias === undefined) return resolveRuntimeSpecies(runtime, name) satisfies SpeciesResolution;
  const species = runtime.speciesById.get(alias.speciesId);
  if (species) {
    return alias.abilityId && species.abilities.includes(alias.abilityId)
      ? { status: "resolved", speciesId: species.id, abilityId: alias.abilityId }
      : { status: "resolved", speciesId: species.id };
  }
  const label = runtime.profile.id === "champions" ? "Champions" : runtime.profile.label;
  return { status: "unavailable", reason: `No exact ${label} match. Use the manual Pokémon selector.` };
}
