import regulations from "@/data/pokemon/regulations.json";
import type {
  FilterRule,
  FormatRules,
  FormKind,
  FormToggleKind,
  GameKey,
  PokemonEntry,
  Preset,
  PresetRule,
  RulesFilters,
  RulesPricing,
  RulesSource,
  StatKey,
  TagKey,
} from "@/app/types/pokemon";

/**
 * The Pool Builder's rule engine (docs/release-architecture.md 13.5 to
 * 13.7): pure functions that turn the dataset, the regulation presets and a
 * format's saved `rules` into the list of Pokémon a pool is built from, and
 * price each one by its stat total. No React, no I/O; `PRESETS` is the
 * committed `data/pokemon/regulations.json` parsed once at module load.
 */

export const RULES_VERSION = "2.0";

/** Points 20 down to 1: entry i is the minimum stat total for 20 - i points. */
export const DEFAULT_BANDS: readonly number[] = [
  700, 680, 650, 620, 600, 580, 560, 540, 520, 500, 480, 460, 440, 420, 400,
  380, 350, 320, 280, 0,
];

export const BAND_COUNT = 20;
export const MAX_POINTS = 20;
export const MIN_POINTS = 1;

/** The largest stat total a row can carry (six stats of at most 255). */
export const MAX_BST = 255 * 6;
export const MAX_STAT = 255;
export const MIN_GENERATION = 1;
export const MAX_GENERATION = 9;

export const GAME_LABELS: Record<GameKey, string> = {
  champions: "Pokémon Champions",
  scarlet_violet: "Scarlet and Violet",
  legends_za: "Legends: Z-A",
  sword_shield: "Sword and Shield",
  legends_arceus: "Legends: Arceus",
  bdsp: "Brilliant Diamond and Shining Pearl",
  lets_go: "Let's Go, Pikachu! and Let's Go, Eevee!",
  ultra_sun_ultra_moon: "Ultra Sun and Ultra Moon",
  sun_moon: "Sun and Moon",
  oras: "Omega Ruby and Alpha Sapphire",
  x_y: "X and Y",
  black_2_white_2: "Black 2 and White 2",
  black_white: "Black and White",
  heartgold_soulsilver: "HeartGold and SoulSilver",
  platinum: "Platinum",
  diamond_pearl: "Diamond and Pearl",
  emerald: "Emerald",
  firered_leafgreen: "FireRed and LeafGreen",
  ruby_sapphire: "Ruby and Sapphire",
  crystal: "Crystal",
  gold_silver: "Gold and Silver",
  yellow: "Yellow",
  red_blue: "Red and Blue",
};

/** The games that get a checkbox in the builder at launch (13.1). */
export const BUILDER_GAMES: readonly GameKey[] = ["champions", "scarlet_violet"];

export const ALL_POKEMON_LABEL = "All Pokémon";

export const TAG_KEYS: readonly TagKey[] = [
  "legendary",
  "sub_legendary",
  "restricted",
  "mythical",
  "paradox",
  "ultra_beast",
];

/** Checkbox labels ("Categories"). */
export const TAG_LABELS: Record<TagKey, string> = {
  legendary: "Legendary",
  sub_legendary: "Sub-legendary",
  restricted: "Restricted",
  mythical: "Mythical",
  paradox: "Paradox",
  ultra_beast: "Ultra Beast",
};

/** The same tags mid-sentence ("no restricted or mythical Pokémon"). */
const TAG_PROSE: Record<TagKey, string> = {
  legendary: "legendary",
  sub_legendary: "sub-legendary",
  restricted: "restricted",
  mythical: "mythical",
  paradox: "Paradox",
  ultra_beast: "Ultra Beast",
};

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  default: "Default",
  mega: "Mega",
  regional: "Regional form",
  gender: "Gender form",
  other: "Other form",
};

export const FORM_TOGGLE_KINDS: readonly FormToggleKind[] = [
  "mega",
  "regional",
  "gender",
  "other",
];

/** Toggle labels ("Forms"). */
export const FORM_TOGGLE_LABELS: Record<FormToggleKind, string> = {
  mega: "Megas",
  regional: "Regional forms",
  gender: "Gender forms",
  other: "Other forms",
};

export const STAT_KEYS: readonly StatKey[] = [
  "hp",
  "attack",
  "defense",
  "special_attack",
  "special_defense",
  "speed",
];

export const STAT_LABELS: Record<StatKey, string> = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  special_attack: "Special Attack",
  special_defense: "Special Defense",
  speed: "Speed",
};

/** Column headers for the preview table. */
export const STAT_SHORT_LABELS: Record<StatKey, string> = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  special_attack: "SpA",
  special_defense: "SpD",
  speed: "Spe",
};

/** The 18 types in the capitalised app spelling the dataset uses. */
export const POKEMON_TYPES: readonly string[] = [
  "Normal",
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
];

const DEX_LABELS: Record<string, string> = {
  paldea: "Paldea",
  kitakami: "Kitakami",
  blueberry: "Blueberry",
  champions: "Champions",
  national: "National",
};

const GAME_KEY_SET = new Set<string>(Object.keys(GAME_LABELS));

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === "string" && GAME_KEY_SET.has(value);
}

export function isTagKey(value: unknown): value is TagKey {
  return typeof value === "string" && (TAG_KEYS as readonly string[]).includes(value);
}

/** The game's name, or the key itself for one the labels do not know yet. */
export function gameLabel(key: string): string {
  return isGameKey(key) ? GAME_LABELS[key] : key;
}

/** "Champions" for "Pokémon Champions": the short form used in summaries. */
export function shortGameLabel(key: string): string {
  return gameLabel(key).replace(/^Pokémon /, "");
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseRanges(value: unknown): Record<string, [number, number][]> | null {
  if (!isRecord(value)) return null;
  const ranges: Record<string, [number, number][]> = {};
  for (const [dex, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const pairs: [number, number][] = [];
    for (const pair of list) {
      if (
        Array.isArray(pair) &&
        pair.length === 2 &&
        Number.isInteger(pair[0]) &&
        Number.isInteger(pair[1])
      ) {
        pairs.push([pair[0] as number, pair[1] as number]);
      }
    }
    ranges[dex] = pairs;
  }
  return Object.keys(ranges).length > 0 ? ranges : null;
}

function parsePresetRule(value: unknown): PresetRule | null {
  if (!isRecord(value)) return null;
  if (value.kind === "roster") {
    return { kind: "roster", slugs: stringList(value.slugs) };
  }
  if (value.kind === "filter") {
    const dexes = Array.isArray(value.dexes) ? stringList(value.dexes) : null;
    return {
      kind: "filter",
      dexes,
      dexRanges: parseRanges(value.dexRanges),
      excludeTags: stringList(value.excludeTags),
      restrictedPerTeam:
        typeof value.restrictedPerTeam === "number" &&
        Number.isInteger(value.restrictedPerTeam)
          ? value.restrictedPerTeam
          : 0,
    };
  }
  return null;
}

/**
 * Reads `data/pokemon/regulations.json` (or any document of that shape).
 * Entries missing a key, name, game or a known rule kind are skipped so a
 * malformed preset never takes the builder down with it.
 */
export function parsePresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  const presets: Preset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rule = parsePresetRule(item.rule);
    if (
      !rule ||
      typeof item.key !== "string" ||
      !item.key ||
      typeof item.name !== "string" ||
      typeof item.game !== "string"
    ) {
      continue;
    }
    presets.push({
      key: item.key,
      game: item.game,
      name: item.name,
      starts: typeof item.starts === "string" ? item.starts : "",
      ends: typeof item.ends === "string" ? item.ends : null,
      source: typeof item.source === "string" ? item.source : "",
      rule,
      ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
    });
  }
  return presets;
}

/** The committed regulation presets (13.6). */
export const PRESETS: readonly Preset[] = parsePresets(regulations);

export function findPreset(
  presets: readonly Preset[],
  key: string | null
): Preset | null {
  if (key === null) return null;
  return presets.find((preset) => preset.key === key) ?? null;
}

/** Presets offered for a source: those of the chosen games, or all of them. */
export function presetsForSource(
  presets: readonly Preset[],
  source: RulesSource
): Preset[] {
  if (source.kind === "all") return [...presets];
  const games = new Set<string>(source.games);
  return presets.filter((preset) => games.has(preset.game));
}

// ---------------------------------------------------------------------------
// Defaults, validation and parsing of a format's rules
// ---------------------------------------------------------------------------

function emptyStats(): Record<StatKey, number | null> {
  return {
    hp: null,
    attack: null,
    defense: null,
    special_attack: null,
    special_defense: null,
    speed: null,
  };
}

function defaultFilters(): RulesFilters {
  return {
    bst: { min: null, max: null },
    stats: emptyStats(),
    generation: { min: null, max: null },
    types: [],
    excludeTags: [],
    forms: { mega: true, regional: true, gender: true, other: true },
  };
}

/** The card's starting state: every Pokémon of the source, priced by bands. */
export function defaultRules(
  source: RulesSource = { kind: "games", games: ["champions"] }
): FormatRules {
  return {
    version: RULES_VERSION,
    source:
      source.kind === "games"
        ? { kind: "games", games: [...source.games] }
        : { kind: "all" },
    preset: null,
    filters: defaultFilters(),
    pricing: { mode: "bands", bands: [...DEFAULT_BANDS] },
  };
}

/**
 * Why a bands list cannot be used, or null when it is exactly 20 integers,
 * each lower than the one before it, ending in 0.
 */
export function bandsProblem(bands: unknown): string | null {
  if (!Array.isArray(bands) || bands.length !== BAND_COUNT) {
    return `Enter ${BAND_COUNT} minimum totals, one per point value.`;
  }
  for (let index = 0; index < bands.length; index += 1) {
    const value: unknown = bands[index];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return `The minimum total for ${MAX_POINTS - index} points must be a whole number.`;
    }
    if (value < 0) {
      return `The minimum total for ${MAX_POINTS - index} points cannot be negative.`;
    }
    if (index > 0 && value >= (bands[index - 1] as number)) {
      return `The minimum total for ${MAX_POINTS - index} points must be lower than the one for ${MAX_POINTS - index + 1} points.`;
    }
  }
  if (bands[BAND_COUNT - 1] !== 0) {
    return "The minimum total for 1 point must be 0 so every Pokémon gets a price.";
  }
  return null;
}

export function isValidBands(bands: unknown): bands is number[] {
  return bandsProblem(bands) === null;
}

function boundProblem(
  label: string,
  value: number | null,
  min: number,
  max: number
): string | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) return `${label} must be a whole number.`;
  if (value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return null;
}

/**
 * Every reason the rules cannot be applied, in display order. An empty list
 * means the rules are usable. An unknown preset key is not a problem: it is
 * ignored when the rules are applied.
 */
export function rulesProblems(rules: FormatRules): string[] {
  const problems: string[] = [];
  const { filters } = rules;

  if (rules.source.kind === "games" && rules.source.games.length === 0) {
    problems.push("Choose at least one game, or start from All Pokémon.");
  }

  const bstMin = boundProblem("Stat total minimum", filters.bst.min, 0, MAX_BST);
  const bstMax = boundProblem("Stat total maximum", filters.bst.max, 0, MAX_BST);
  if (bstMin) problems.push(bstMin);
  if (bstMax) problems.push(bstMax);
  if (
    !bstMin &&
    !bstMax &&
    filters.bst.min !== null &&
    filters.bst.max !== null &&
    filters.bst.min > filters.bst.max
  ) {
    problems.push("Stat total minimum cannot be above the maximum.");
  }

  for (const stat of STAT_KEYS) {
    const problem = boundProblem(
      `Maximum ${STAT_LABELS[stat]}`,
      filters.stats[stat],
      0,
      MAX_STAT
    );
    if (problem) problems.push(problem);
  }

  const genMin = boundProblem(
    "Generation minimum",
    filters.generation.min,
    MIN_GENERATION,
    MAX_GENERATION
  );
  const genMax = boundProblem(
    "Generation maximum",
    filters.generation.max,
    MIN_GENERATION,
    MAX_GENERATION
  );
  if (genMin) problems.push(genMin);
  if (genMax) problems.push(genMax);
  if (
    !genMin &&
    !genMax &&
    filters.generation.min !== null &&
    filters.generation.max !== null &&
    filters.generation.min > filters.generation.max
  ) {
    problems.push("Generation minimum cannot be above the maximum.");
  }

  if (rules.pricing.mode === "bands") {
    const problem = bandsProblem(rules.pricing.bands);
    if (problem) problems.push(problem);
  }

  return problems;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseSource(value: unknown): RulesSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "all") return { kind: "all" };
  if (value.kind === "games") {
    return { kind: "games", games: stringList(value.games).filter(isGameKey) };
  }
  return null;
}

function parsePricing(value: unknown): RulesPricing | null {
  if (!isRecord(value)) return null;
  if (value.mode === "manual") return { mode: "manual" };
  if (value.mode === "bands" && isValidBands(value.bands)) {
    return { mode: "bands", bands: [...value.bands] };
  }
  return null;
}

/**
 * Reads a saved `rules` object. Returns null when the document is not a
 * rules object at all (no recognisable source); every other field falls
 * back to its default so an older or hand-edited document still loads.
 */
export function parseFormatRules(value: unknown): FormatRules | null {
  if (!isRecord(value)) return null;
  const source = parseSource(value.source);
  if (!source) return null;

  const base = defaultRules(source);
  const filters = isRecord(value.filters) ? value.filters : {};
  const bst = isRecord(filters.bst) ? filters.bst : {};
  const stats = isRecord(filters.stats) ? filters.stats : {};
  const generation = isRecord(filters.generation) ? filters.generation : {};
  const forms = isRecord(filters.forms) ? filters.forms : {};

  const parsedStats = emptyStats();
  for (const stat of STAT_KEYS) {
    parsedStats[stat] = optionalInteger(stats[stat]);
  }
  const parsedForms = { ...base.filters.forms };
  for (const kind of FORM_TOGGLE_KINDS) {
    if (typeof forms[kind] === "boolean") parsedForms[kind] = forms[kind];
  }

  return {
    version: typeof value.version === "string" ? value.version : RULES_VERSION,
    source,
    preset: typeof value.preset === "string" && value.preset ? value.preset : null,
    filters: {
      bst: { min: optionalInteger(bst.min), max: optionalInteger(bst.max) },
      stats: parsedStats,
      generation: {
        min: optionalInteger(generation.min),
        max: optionalInteger(generation.max),
      },
      types: stringList(filters.types),
      excludeTags: stringList(filters.excludeTags).filter(isTagKey),
      forms: parsedForms,
    },
    pricing: parsePricing(value.pricing) ?? base.pricing,
  };
}

// ---------------------------------------------------------------------------
// Applying rules
// ---------------------------------------------------------------------------

function inSource(entry: PokemonEntry, source: RulesSource): boolean {
  if (source.kind === "all") return true;
  return source.games.some((game) => entry.games.includes(game));
}

function hasAnyTag(entry: PokemonEntry, tags: readonly string[]): boolean {
  return tags.some((tag) => entry.tags.includes(tag));
}

function withinRanges(value: number, ranges: readonly [number, number][]) {
  return ranges.some(([low, high]) => value >= low && value <= high);
}

/** 13.6: Pokédex membership, entry ranges and excluded tags, in the game. */
function passesFilterRule(
  entry: PokemonEntry,
  rule: FilterRule,
  game: string
): boolean {
  if (!entry.games.includes(game)) return false;
  if (rule.dexes !== null && !rule.dexes.some((dex) => dex in entry.dex_numbers)) {
    return false;
  }
  if (rule.dexRanges !== null) {
    for (const [dex, ranges] of Object.entries(rule.dexRanges)) {
      const number = entry.dex_numbers[dex];
      if (typeof number !== "number" || !withinRanges(number, ranges)) {
        return false;
      }
    }
  }
  return !hasAnyTag(entry, rule.excludeTags);
}

function passesPreset(entry: PokemonEntry, preset: Preset, roster: Set<string>) {
  if (preset.rule.kind === "roster") return roster.has(entry.slug);
  return passesFilterRule(entry, preset.rule, preset.game);
}

function passesFilters(entry: PokemonEntry, filters: RulesFilters): boolean {
  const { bst, stats, generation, types, excludeTags, forms } = filters;
  if (bst.min !== null && entry.bst < bst.min) return false;
  if (bst.max !== null && entry.bst > bst.max) return false;
  for (const stat of STAT_KEYS) {
    const max = stats[stat];
    if (max !== null && entry[stat] > max) return false;
  }
  if (generation.min !== null && entry.generation < generation.min) return false;
  if (generation.max !== null && entry.generation > generation.max) return false;
  if (types.length > 0) {
    const wanted = new Set(types.map((type) => type.toLowerCase()));
    const own = [entry.type1, entry.type2]
      .filter((type): type is string => typeof type === "string" && type !== "")
      .map((type) => type.toLowerCase());
    if (!own.some((type) => wanted.has(type))) return false;
  }
  if (hasAnyTag(entry, excludeTags)) return false;
  if (entry.form_kind !== "default" && !forms[entry.form_kind]) return false;
  return true;
}

export function compareEntries(a: PokemonEntry, b: PokemonEntry): number {
  if (a.bst !== b.bst) return b.bst - a.bst;
  const byName = a.display_name.localeCompare(b.display_name, "en");
  return byName !== 0 ? byName : a.id - b.id;
}

/**
 * The Pokémon a format's rules select from the dataset, sorted by stat total
 * descending then display name (13.5): the source first, then the preset
 * (a roster intersects on slug; a filter rule applies 13.6), then the
 * format's own filters. A preset key the list does not know is ignored.
 */
export function applyRules(
  entries: readonly PokemonEntry[],
  presets: readonly Preset[],
  rules: FormatRules
): PokemonEntry[] {
  const preset = findPreset(presets, rules.preset);
  const roster = new Set(preset?.rule.kind === "roster" ? preset.rule.slugs : []);

  return entries
    .filter(
      (entry) =>
        inSource(entry, rules.source) &&
        (preset === null || passesPreset(entry, preset, roster)) &&
        passesFilters(entry, rules.filters)
    )
    .sort(compareEntries);
}

/**
 * Points for a stat total: 20 - i for the first band i the total reaches,
 * and 1 when it reaches none (the last band is 0, so that only happens with
 * an invalid list).
 */
export function priceByBands(bst: number, bands: readonly number[]): number {
  for (let index = 0; index < bands.length && index < BAND_COUNT; index += 1) {
    if (bst >= bands[index]) return MAX_POINTS - index;
  }
  return MIN_POINTS;
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/** "Fire, Water and Grass" */
function joinNames(names: readonly string[], conjunction = "and"): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

function dexLabel(dex: string): string {
  return DEX_LABELS[dex] ?? dex.charAt(0).toUpperCase() + dex.slice(1);
}

function tagProse(tag: string): string {
  return isTagKey(tag) ? TAG_PROSE[tag] : tag.replace(/_/g, " ");
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** "Jan 2, 2023" in UTC, so the label is the same wherever it renders. */
export function formatPresetDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "Jan 2, 2023 to Jan 31, 2023", or "From Apr 1, 2026" for a current set. */
export function presetDates(preset: Preset): string {
  if (!preset.starts) return preset.ends ? `Until ${formatPresetDate(preset.ends)}` : "";
  const starts = formatPresetDate(preset.starts);
  return preset.ends ? `${starts} to ${formatPresetDate(preset.ends)}` : `From ${starts}`;
}

/**
 * The rule in words: "Paldea and Kitakami Pokédexes, no restricted or
 * mythical Pokémon"; "A fixed roster of 312 Pokémon"; "Roster not loaded
 * yet" for a roster the data build has not filled.
 */
export function describePreset(preset: Preset): string {
  const { rule } = preset;
  if (rule.kind === "roster") {
    if (rule.slugs.length === 0) return "Roster not loaded yet";
    return `A fixed roster of ${formatCount(rule.slugs.length)} Pokémon`;
  }

  const parts: string[] = [];
  if (rule.dexes === null) {
    parts.push("Everything transferable");
  } else {
    const names = rule.dexes.map(dexLabel);
    parts.push(`${joinNames(names)} ${names.length === 1 ? "Pokédex" : "Pokédexes"}`);
  }
  if (rule.dexRanges !== null) {
    const ranges = Object.entries(rule.dexRanges).map(([dex, list]) => {
      const spans = list.map(([low, high]) => (low === high ? `${low}` : `${low} to ${high}`));
      return `${dexLabel(dex)} entries ${joinNames(spans)}`;
    });
    parts.push(...ranges);
  }
  if (rule.excludeTags.length > 0) {
    parts.push(`no ${joinNames(rule.excludeTags.map(tagProse), "or")} Pokémon`);
  }
  if (rule.restrictedPerTeam > 0) {
    parts.push(
      `${rule.restrictedPerTeam === 1 ? "one" : rule.restrictedPerTeam === 2 ? "two" : rule.restrictedPerTeam} restricted per team`
    );
  }
  return parts.join(", ");
}

function statProse(stat: StatKey): string {
  return stat === "hp" ? "HP" : STAT_LABELS[stat].toLowerCase();
}

/**
 * One line for the format library: "Champions · Regulation Set M-C · max
 * total 600". Lists only what departs from the defaults.
 */
export function describeRules(
  rules: FormatRules,
  presets: readonly Preset[]
): string {
  const parts: string[] = [];
  const { source, filters } = rules;

  if (source.kind === "all") {
    parts.push(ALL_POKEMON_LABEL);
  } else if (source.games.length > 0) {
    parts.push(joinNames(source.games.map(shortGameLabel)));
  } else {
    parts.push("No game chosen");
  }

  const preset = findPreset(presets, rules.preset);
  if (preset) parts.push(preset.name);

  if (filters.bst.min !== null && filters.bst.max !== null) {
    parts.push(`total ${filters.bst.min} to ${filters.bst.max}`);
  } else if (filters.bst.min !== null) {
    parts.push(`min total ${filters.bst.min}`);
  } else if (filters.bst.max !== null) {
    parts.push(`max total ${filters.bst.max}`);
  }

  for (const stat of STAT_KEYS) {
    const max = filters.stats[stat];
    if (max !== null) parts.push(`max ${statProse(stat)} ${max}`);
  }

  if (filters.generation.min !== null && filters.generation.max !== null) {
    parts.push(
      filters.generation.min === filters.generation.max
        ? `gen ${filters.generation.min}`
        : `gen ${filters.generation.min} to ${filters.generation.max}`
    );
  } else if (filters.generation.min !== null) {
    parts.push(`gen ${filters.generation.min} and up`);
  } else if (filters.generation.max !== null) {
    parts.push(`up to gen ${filters.generation.max}`);
  }

  if (filters.types.length > 0) {
    parts.push(`${joinNames(filters.types, "or")} types`);
  }

  if (filters.excludeTags.length > 0) {
    parts.push(`no ${joinNames(filters.excludeTags.map(tagProse), "or")}`);
  }

  const hidden = FORM_TOGGLE_KINDS.filter((kind) => !filters.forms[kind]);
  if (hidden.length > 0) {
    parts.push(`no ${joinNames(hidden.map((kind) => FORM_TOGGLE_LABELS[kind]), "or")}`);
  }

  if (rules.pricing.mode === "manual") parts.push("manual prices");

  return parts.join(" · ");
}
