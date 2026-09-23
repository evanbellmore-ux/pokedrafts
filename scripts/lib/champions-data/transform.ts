import type {
  BattleStat,
  ChampionsCatalog,
  ChampionsItem,
  ChampionsMove,
  StatTable,
} from "../../../app/lib/battle/types";

/** Showdown identities only: never infer forms from PokeAPI names or numbers. */
export function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type NamedData = { id: string; name: string };
export type AvailableData = NamedData & {
  exists: boolean;
  isNonstandard?: string | null;
};
export type LearnsetSource = {
  speciesId: string;
  /** Captured BEFORE Dex.loadData mutates the mod's tables with inherited data. */
  origin: "champions" | "explicit-inherit" | "unproven";
  learnset: Record<string, readonly string[]>;
};
export type ResolvedLearnset = {
  /** Actual Dex.mod('champions').species.getMovePool result, not a hand-built union. */
  movePool: readonly string[];
  /** Actual getFullLearnset lineage, including changesFrom/battleOnly inheritance. */
  sources: readonly LearnsetSource[];
  error?: string;
};
export type ResolvedSpecies = AvailableData & {
  baseSpecies: string;
  types: readonly string[];
  baseStats: StatTable;
  weightkg: number;
  abilities: Record<string, string>;
  battleOnly?: string | readonly string[];
  changesFrom?: string;
  isMega?: boolean;
  requiredItem?: string;
  requiredItems?: readonly string[];
  learnset: ResolvedLearnset;
};
export type ResolvedMove = AvailableData & {
  type: string;
  category: ChampionsMove["category"];
  basePower: number;
  accuracy: number | true;
  priority: number;
  target: string;
  multihit?: number | [number, number];
  ohko?: boolean | string;
  description: string;
};
export type ResolvedAbility = AvailableData & { description: string };
export type ResolvedItem = AvailableData & {
  description: string;
  megaStone?: Record<string, string>;
};
export type ShowdownSnapshot = {
  species: readonly ResolvedSpecies[];
  moves: readonly ResolvedMove[];
  abilities: readonly ResolvedAbility[];
  items: readonly ResolvedItem[];
};
export type EngineSnapshot = {
  num: number;
  species: readonly (NamedData & {
    types: readonly string[];
    baseStats: Readonly<StatTable>;
    weightkg: number;
  })[];
  moves: readonly (NamedData & {
    type: string;
    category?: ChampionsMove["category"];
    basePower: number;
  })[];
  abilities: readonly NamedData[];
  items: readonly (NamedData & { megaStone?: Readonly<Record<string, string>> })[];
};

const STATS: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
// Explicit pinned-source identities, never a generic base-species fallback.
// Aegislash-Both is an engine-only hypothetical state and is never game data.
// These seven available Alcremie forms are declared cosmetic in Showdown's
// pokedex; gen0 stores their identical battle data under Alcremie. All ordinary
// data/provenance mismatch gates below still apply to each exact catalog form.
const ENGINE_SPECIES_IDS: Readonly<Record<string, string>> = {
  aegislash: "aegislashshield",
  alcremiecaramelswirl: "alcremie",
  alcremielemoncream: "alcremie",
  alcremiematchacream: "alcremie",
  alcremiemintcream: "alcremie",
  alcremierainbowswirl: "alcremie",
  alcremierubycream: "alcremie",
  alcremierubyswirl: "alcremie",
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compare);
const byID = <T extends NamedData>(a: T, b: T) => compare(a.id, b.id);
export const isAvailable = (row: AvailableData) => row.exists && !row.isNonstandard;

function index<T extends NamedData>(rows: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!row.id || row.id !== toID(row.name)) {
      throw new Error(`Noncanonical ${kind} identity: ${row.id} / ${row.name}`);
    }
    if (result.has(row.id)) throw new Error(`Duplicate ${kind} identity: ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}

/** Standard battle-only states require an available entry form; tiers are not availability. */
export function availableSpecies(rows: readonly ResolvedSpecies[]): ResolvedSpecies[] {
  const all = index(rows.filter(isAvailable), "species");
  const cache = new Map<string, boolean>();
  function available(id: string, path = new Set<string>()): boolean {
    if (cache.has(id)) return cache.get(id)!;
    const row = all.get(id);
    if (!row || !isAvailable(row)) return false;
    if (path.has(id)) throw new Error(`Cyclic battle form relationship: ${id}`);
    const next = new Set(path).add(id);
    const parents = typeof row.battleOnly === "string" ? [row.battleOnly] : row.battleOnly;
    const value = !parents?.length || parents.some((name) => available(toID(name), next));
    cache.set(id, value);
    return value;
  }
  return rows.filter((row) => available(row.id)).sort(byID);
}

/**
 * A Gen 9 source marker alone is NOT Champions provenance. getMovePool accepts 9M,
 * but so do inherited Scarlet/Violet tables. Only explicitly declared mod tables
 * (or explicit `inherit: true`) may prove a contributing learnset. Missing proof
 * yields a flagged, possibly partial list, never a silent Gen 9 fallback.
 */
export function resolveChampionsLearnset(data: ResolvedLearnset) {
  const unsupported: string[] = [];
  if (data.error) unsupported.push(`Champions learnset resolution failed: ${data.error}`);
  const unprovenSources = data.sources.filter((source) => source.origin === "unproven");
  const hasProof = data.sources.some((source) => source.origin !== "unproven");
  if (!hasProof) unsupported.push("No proven Champions learnset.");
  const provenMoves = new Set<string>();
  for (const source of data.sources) {
    if (source.origin === "unproven") continue;
    for (const [id, markers] of Object.entries(source.learnset)) {
      // Match the resolved mod's Gen 9 semantics, not an invented '9C' marker.
      if (markers.some((marker) => marker.startsWith("9"))) provenMoves.add(id);
    }
  }
  const unprovenMoves = sorted(data.movePool.filter((id) => !provenMoves.has(id)));
  // A traversed ancestor is harmless if every resulting move already has direct
  // Champions proof (Floette-Eternal traverses Flabebe but gains no extra moves).
  if (unprovenMoves.length || !hasProof) {
    for (const source of unprovenSources) {
      unsupported.push(`Unproven Champions learnset: ${source.speciesId} is inherited from the base game.`);
    }
  }
  if (unprovenMoves.length) {
    unsupported.push(`Moves without Champions provenance withheld: ${unprovenMoves.join(", ")}.`);
  }
  return {
    moves: sorted(data.movePool.filter((id) => provenMoves.has(id))),
    unsupported: sorted(unsupported),
  };
}

function megaTargets(stone?: Readonly<Record<string, string>>): ChampionsItem["megaTargets"] {
  return Object.entries(stone ?? {}).map(([base, form]) => ({
    baseSpeciesId: toID(base), formId: toID(form),
  })).sort((a, b) => compare(a.baseSpeciesId, b.baseSpeciesId) || compare(a.formId, b.formId));
}

/** Pure, deterministic transformation. Raw game stats/types/weight always win over engine data. */
export function transformChampionsCatalog(
  source: ShowdownSnapshot,
  engine: EngineSnapshot,
  sources: ChampionsCatalog["sources"],
): ChampionsCatalog {
  if (engine.num !== 0) throw new Error("Champions requires engine generation 0, not mainline Gen 9.");
  // Nonstandard tables can contain aliases sharing an ID (Hidden Power types).
  // They are not Champions entries and must not enter identity/reference checks.
  const dexMoves = index(source.moves.filter(isAvailable), "move");
  const dexAbilities = index(source.abilities.filter((row) => row.exists), "ability");
  const dexItems = index(source.items.filter(isAvailable), "item");
  const engineSpecies = index(engine.species, "engine species");
  const engineMoves = index(engine.moves, "engine move");
  const engineAbilities = index(engine.abilities, "engine ability");
  const engineItems = index(engine.items, "engine item");
  const eligible = availableSpecies(source.species);
  const eligibleIDs = new Set(eligible.map((row) => row.id));
  const assignedAbilities = new Set<string>();
  const learnsets = new Map(eligible.map((row) => [row.id, resolveChampionsLearnset(row.learnset)]));

  for (const row of eligible) {
    if (!Object.keys(row.abilities).length) throw new Error(`No ability assignments: ${row.id}`);
    for (const name of Object.values(row.abilities)) {
      const id = toID(name);
      const ability = dexAbilities.get(id);
      if (!ability) throw new Error(`Invalid Champions ability assignment: ${row.id} -> ${id}`);
      // An available species may contradict the mod's ability availability (the
      // pinned Lucario-Mega-Z assigns Future Aura Guard). Preserve the reference
      // and explicitly flag both rows, rather than inventing another assignment.
      assignedAbilities.add(id);
    }
    for (const id of learnsets.get(row.id)!.moves) {
      const move = dexMoves.get(id);
      if (!move || !isAvailable(move)) {
        throw new Error(`Invalid Champions learnset reference: ${row.id} -> ${id}`);
      }
    }
    if (row.requiredItem) {
      const item = dexItems.get(toID(row.requiredItem));
      if (!item || !isAvailable(item)) {
        throw new Error(`Invalid required Champions item: ${row.id} -> ${row.requiredItem}`);
      }
    }
    if (row.isMega) {
      const stone = row.requiredItem && dexItems.get(toID(row.requiredItem));
      const parents = typeof row.battleOnly === "string" ? [row.battleOnly] : row.battleOnly ?? [];
      if (!stone || !megaTargets(stone.megaStone).some((target) =>
        target.formId === row.id && parents.some((parent) => toID(parent) === target.baseSpeciesId))) {
        throw new Error(`Invalid Mega stone/form relationship: ${row.id}`);
      }
    }
  }

  const abilities = sorted(assignedAbilities).map((id) => {
    const row = dexAbilities.get(id)!;
    const calc = engineAbilities.get(id);
    return {
      id,
      name: calc?.name ?? row.name,
      description: row.description,
      unsupported: [
        ...(!isAvailable(row) ? [`Assigned Champions ability is marked ${row.isNonstandard} in the source.`] : []),
        ...(!calc ? [`Engine ability missing: ${row.name}.`] : []),
      ],
    };
  });
  const items = source.items.filter(isAvailable).sort(byID).map((row): ChampionsItem => {
    const calc = engineItems.get(row.id);
    const targets = megaTargets(row.megaStone);
    const unsupported: string[] = [];
    if (!calc) unsupported.push(`Engine item missing: ${row.name}.`);
    if (calc && JSON.stringify(targets) !== JSON.stringify(megaTargets(calc.megaStone))) {
      unsupported.push("Engine Mega stone targets differ from Champions data.");
    }
    for (const target of targets) {
      if (!eligibleIDs.has(target.baseSpeciesId) || !eligibleIDs.has(target.formId)) {
        throw new Error(`Mega stone references an unavailable species: ${row.id} -> ${target.formId}`);
      }
      const form = eligible.find((species) => species.id === target.formId)!;
      if (toID(form.requiredItem ?? "") !== row.id) {
        throw new Error(`Mega form requires a different stone: ${row.id} -> ${target.formId}`);
      }
    }
    return {
      id: row.id,
      name: calc?.name ?? row.name,
      description: row.description,
      megaStone: targets.length === 1 ? targets[0].formId : null,
      megaEvolves: targets.length === 1 ? targets[0].baseSpeciesId : null,
      megaTargets: targets,
      unsupported,
    };
  });
  const abilityIndex = new Map(abilities.map((row) => [row.id, row]));
  const itemIndex = new Map(items.map((row) => [row.id, row]));

  // All available moves, not just positive-power attacks or the union of selected species' moves.
  const moves = source.moves.filter(isAvailable).sort(byID).map((row): ChampionsMove => {
    const calc = engineMoves.get(row.id);
    const unsupported: string[] = [];
    if (!calc) unsupported.push(`Engine move missing: ${row.name}.`);
    if (calc && calc.type !== row.type) unsupported.push(`Engine move type differs: ${calc.type} vs ${row.type}.`);
    if (calc && calc.category !== row.category) {
      unsupported.push(`Engine move category differs: ${calc.category ?? "missing"} vs ${row.category}.`);
    }
    if (calc && calc.basePower !== row.basePower) {
      unsupported.push(`Engine move power differs: ${calc.basePower} vs ${row.basePower}.`);
    }
    return {
      id: row.id,
      name: calc?.name ?? row.name,
      type: row.type,
      category: row.category,
      power: row.basePower,
      accuracy: typeof row.accuracy === "number" ? row.accuracy : null,
      priority: row.priority,
      target: row.target,
      multihit: Array.isArray(row.multihit) ? [...row.multihit] : row.multihit ?? null,
      ohko: Boolean(row.ohko),
      description: row.description,
      unsupported,
    };
  });
  const species = eligible.map((row) => {
    const calc = engineSpecies.get(ENGINE_SPECIES_IDS[row.id] ?? row.id);
    const learnset = learnsets.get(row.id)!;
    const unsupported = [...learnset.unsupported];
    if (!calc) unsupported.push(`Engine species missing: ${row.name}.`);
    if (calc && JSON.stringify(calc.types) !== JSON.stringify(row.types)) {
      unsupported.push(`Engine species types differ: ${calc.types.join("/")} vs ${row.types.join("/")}.`);
    }
    for (const stat of STATS) {
      if (!Number.isFinite(row.baseStats[stat]) || row.baseStats[stat] <= 0) {
        throw new Error(`Invalid base stat: ${row.id}.${stat}`);
      }
      if (calc && calc.baseStats[stat] !== row.baseStats[stat]) {
        unsupported.push(`Engine base stat differs (${stat}): ${calc.baseStats[stat]} vs ${row.baseStats[stat]}.`);
      }
    }
    if (!Number.isFinite(row.weightkg) || row.weightkg <= 0) throw new Error(`Invalid weight: ${row.id}`);
    if (calc && calc.weightkg !== row.weightkg) {
      unsupported.push(`Engine weight differs: ${calc.weightkg} vs ${row.weightkg} kg.`);
    }
    const abilityIDs = sorted(Object.values(row.abilities).map(toID));
    // Optional ability gaps are gated on the selected ability by the adapter,
    // not by disabling every otherwise-supported build of that species.
    if (abilityIDs.every((id) => abilityIndex.get(id)!.unsupported.length)) {
      unsupported.push(`All assigned abilities unsupported: ${abilityIDs.join(", ")}.`);
    }
    const requiredItem = row.requiredItem ? toID(row.requiredItem) : null;
    if (requiredItem && itemIndex.get(requiredItem)!.unsupported.length) {
      unsupported.push(`Required item unsupported: ${requiredItem}.`);
    }
    if ((row.requiredItems?.length ?? 0) > 1) {
      unsupported.push("Multiple required item alternatives are not represented by requiredItem.");
    }
    return {
      id: row.id,
      name: row.name,
      calcName: calc?.name ?? row.name,
      // Dex's taxonomic identity, NOT changesFrom (e.g. Floette-Mega -> floette).
      baseSpecies: toID(row.baseSpecies),
      types: [...row.types],
      baseStats: Object.fromEntries(STATS.map((stat) => [stat, row.baseStats[stat]])) as StatTable,
      weightkg: row.weightkg,
      abilities: abilityIDs,
      moves: learnset.moves,
      battleForm: Boolean(row.battleOnly),
      requiredItem,
      unsupported: sorted(unsupported),
    };
  });
  const unsupportedSpecies = species.filter((row) => row.unsupported.length);
  const unsupportedMoves = moves.filter((row) => row.unsupported.length);
  const notes = [
    "Availability uses resolved Champions isNonstandard flags and available battleOnly entry forms, not competitive tiers; OU bans and Uber rankings are not game exclusions.",
    "All IDs and references use Showdown toID. baseSpecies is the taxonomic ID, not a transform parent or guaranteed available catalog row; Mega targets use the actual battleOnly entry form. The explicit Aegislash engine name is Aegislash-Shield, never Aegislash-Both. The seven emitted Alcremie cosmetic forms explicitly share engine Alcremie while retaining exact catalog identities; this is not a generic base-form fallback.",
    "Learnsets use Champions getFullLearnset/getMovePool semantics, including form inheritance, with explicit mod provenance. Gen 9 markers such as 9M do not by themselves prove Champions legality; unproven inherited moves are withheld and flagged.",
    "All available moves are retained, including Status, zero-power, fixed-damage and multihit moves. Data coverage checks engine identities, types, categories, power, base stats, weight and Mega targets, not implementation of mechanics; the battle adapter must apply its mechanics/context gate.",
    "Abilities are the resolved assignments of available species; item availability is resolved independently. Engine ability/item name presence is not evidence that their mechanics are implemented.",
    "Raw Showdown stats, types and weight are never replaced with engine values. A species with a data mismatch remains in the catalog, explicitly unsupported.",
  ];
  for (const [label, rows] of [
    ["Species with engine/data/provenance gaps", unsupportedSpecies],
    ["Moves with engine/data gaps", unsupportedMoves],
    ["Abilities with engine/source gaps", abilities.filter((row) => row.unsupported.length)],
    ["Items with engine/data gaps", items.filter((row) => row.unsupported.length)],
    ["Species with incomplete Champions learnsets", species.filter((row) => learnsets.get(row.id)!.unsupported.length)],
  ] as const) {
    notes.push(`${label} (${rows.length}): ${rows.length ? rows.map((row) => row.id).join(", ") : "none"}.`);
  }
  return {
    version: 1,
    game: "champions",
    level: 50,
    sources: { engine: { ...sources.engine }, showdown: { ...sources.showdown } },
    species,
    moves,
    abilities,
    items,
    coverage: {
      species: species.length,
      moves: moves.length,
      unsupportedSpecies: unsupportedSpecies.length,
      unsupportedMoves: unsupportedMoves.length,
      notes,
    },
  };
}
