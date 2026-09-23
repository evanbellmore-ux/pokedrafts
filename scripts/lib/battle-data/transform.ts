import type { BattleStat, ChampionsCatalog, StatTable } from "../../../app/lib/battle/types";
import { isAvailable, toID, type NamedData } from "../champions-data/transform";
import { compare, sorted } from "./sources";
import type {
  NativeCatalog,
  NativeEngineSnapshot,
  NativeItem,
  NativeMove,
  NativeResolvedSpecies,
  NativeSnapshot,
  NativeSpecies,
} from "./types";

const STATS: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
const byID = (a: NamedData, b: NamedData) => compare(a.id, b.id);
function index<T extends NamedData>(rows: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!row.id || row.id !== toID(row.name)) throw new Error(`Noncanonical ${kind} identity: ${row.id} / ${row.name}`);
    if (result.has(row.id)) throw new Error(`Duplicate ${kind} identity: ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}
const targets = (stone?: Readonly<Record<string, string>>) => Object.entries(stone ?? {}).map(([base, form]) => ({
  baseSpeciesId: toID(base), formId: toID(form),
})).sort((a, b) => compare(a.baseSpeciesId, b.baseSpeciesId) || compare(a.formId, b.formId));
const parents = (row: NativeResolvedSpecies) => typeof row.battleOnly === "string" ? [row.battleOnly] : row.battleOnly ?? [];

export function nativeSpecies(source: NativeSnapshot): NativeResolvedSpecies[] {
  // Gmax data entries explicitly say placeholderFor and weigh 0 kg. They encode
  // a factor, not playable species; retain their names in gmaxNames instead.
  const all = index(source.species.filter((row) => isAvailable(row) && !row.placeholderFor), "species");
  const memo = new Map<string, boolean>();
  function available(id: string, path = new Set<string>()): boolean {
    if (memo.has(id)) return memo.get(id)!;
    const row = all.get(id);
    if (!row) return false;
    if (path.has(id)) throw new Error(`Cyclic battle form relationship: ${id}`);
    const entryForms = parents(row);
    const valid = !entryForms.length || entryForms.some((name) => available(toID(name), new Set(path).add(id)));
    memo.set(id, valid);
    return valid;
  }
  return [...all.values()].filter((row) => available(row.id)).sort(byID);
}

/** Every alias has explicit pinned-source identity proof, never a base fallback. */
export function engineSpeciesID(row: NativeResolvedSpecies, engineIDs: ReadonlySet<string>): string {
  if (engineIDs.has(row.id)) return row.id;
  if (row.id === "aegislash" && row.baseForme === "Shield") return "aegislashshield";
  if (row.isCosmeticForme && row.cosmeticParent) return row.cosmeticParent;
  return row.id;
}

/** Diagnostics for an engine hint bypassed only by a separately verified exact override. */
export function engineHintDiscrepancies(source: NativeSnapshot, engine: NativeEngineSnapshot) {
  if (source.profile.gen !== 8) return [];
  const species = new Map(engine.species.map((row) => [row.id, row]));
  const engineIDs = new Set(species.keys());
  return nativeSpecies(source).flatMap((row) => {
    const calc = species.get(engineSpeciesID(row, engineIDs));
    if (!row.canGigantamax || row.gmaxUnreleased || !calc || toID(calc.canGigantamax ?? "") === toID(row.canGigantamax)) return [];
    // Pinned engine's Butterfree species hint is misspelled; the actual Befuddle
    // move and explicit dist/move override are correct, including clone/calculate.
    // Do not generalize this exception to other species or future source changes.
    const verifiedSignatureOverride = row.id === "butterfree" && row.canGigantamax === "G-Max Befuddle" &&
      calc.canGigantamax === "G-Max Flutterby";
    return [{
      speciesId: row.id, field: "canGigantamax", engineValue: calc.canGigantamax ?? null,
      sourceValue: row.canGigantamax, verifiedSignatureOverride,
      resolution: verifiedSignatureOverride ? "Use exact catalog signature with the tested dist/move overrideMove adapter; never the engine species hint." : "Unsupported engine/source hint mismatch.",
    }];
  });
}

/** Resolved native data wins over engine defaults; all mismatches remain visible. */
export function transformNativeCatalog(
  source: NativeSnapshot,
  engine: NativeEngineSnapshot,
  sources: ChampionsCatalog["sources"],
): NativeCatalog {
  const { profile } = source;
  if (engine.num !== profile.gen) throw new Error(`${profile.game} requires engine generation ${profile.gen}.`);
  const eligible = nativeSpecies(source);
  const speciesByID = index(eligible, "species");
  const movesByID = index(source.moves.filter(isAvailable), "move");
  const itemsByID = index(source.items.filter(isAvailable), "item");
  const abilitiesByID = index(source.abilities.filter((row) => row.exists), "ability");
  const engineSpecies = index(engine.species, "engine species");
  const engineMoves = index(engine.moves, "engine move");
  const engineAbilities = index(engine.abilities, "engine ability");
  const engineItems = index(engine.items, "engine item");
  const engineIDs = new Set(engineSpecies.keys());
  const hintDiscrepancies = engineHintDiscrepancies(source, engine);
  const hintBySpecies = new Map(hintDiscrepancies.map((row) => [row.speciesId, row]));
  const usedAbilities = new Set<string>();
  const typedHiddenPower = sorted([...movesByID.values()].filter((row) =>
    row.placeholderFor === "Hidden Power" && engineMoves.has(row.id)).map((row) => row.id));
  const gmaxNames = new Map<string, string[]>();
  if (profile.gen === 8) {
    for (const row of source.species.filter((row) => isAvailable(row) && row.placeholderFor)) {
      const base = speciesByID.get(toID(row.placeholderFor!));
      if (!base?.canGigantamax || base.gmaxUnreleased) throw new Error(`Unverified Gmax placeholder: ${row.id}`);
      gmaxNames.set(base.id, sorted([...(gmaxNames.get(base.id) ?? []), row.name]));
    }
  }
  for (const row of eligible) {
    if (!Object.keys(row.abilities).length) throw new Error(`No ability assignments: ${row.id}`);
    for (const name of Object.values(row.abilities)) {
      const id = toID(name);
      if (!abilitiesByID.has(id)) throw new Error(`Invalid native ability assignment: ${row.id} -> ${id}`);
      usedAbilities.add(id);
    }
    if (row.requiredMove && !movesByID.has(toID(row.requiredMove))) {
      throw new Error(`Unavailable required move: ${row.id} -> ${row.requiredMove}`);
    }
    if (profile.gen === 8 && row.canGigantamax && !row.gmaxUnreleased) {
      const move = movesByID.get(toID(row.canGigantamax));
      if (!move?.isMax) throw new Error(`Invalid Gmax signature: ${row.id} -> ${row.canGigantamax}`);
    }
    if (row.isMega && !row.requiredMove) {
      const stone = row.requiredItem && itemsByID.get(toID(row.requiredItem));
      if (!stone || !targets(stone.megaStone).some((target) => target.formId === row.id &&
        parents(row).some((parent) => toID(parent) === target.baseSpeciesId))) {
        throw new Error(`Invalid Mega stone/form relationship: ${row.id}`);
      }
    }
  }

  const abilities = sorted(usedAbilities).map((id) => {
    const row = abilitiesByID.get(id)!;
    return {
      id, name: row.name, description: row.description,
      unsupported: sorted([
        ...(!isAvailable(row) ? [`Assigned native ability is marked ${row.isNonstandard} in the source.`] : []),
        ...(!engineAbilities.has(id) ? [`Engine ability missing: ${row.name}.`] : []),
      ]),
    };
  });
  const items = [...itemsByID.values()].sort(byID).map((row): NativeItem => {
    const calc = engineItems.get(row.id);
    const megaTargets = targets(row.megaStone);
    const unsupported: string[] = [];
    if (!calc) unsupported.push(`Engine item missing: ${row.name}.`);
    if (calc && JSON.stringify(megaTargets) !== JSON.stringify(targets(calc.megaStone))) {
      unsupported.push("Engine Mega stone targets differ from native game data.");
    }
    for (const target of megaTargets) {
      const form = speciesByID.get(target.formId);
      if (!speciesByID.has(target.baseSpeciesId) || !form || toID(form.requiredItem ?? "") !== row.id) {
        throw new Error(`Mega stone references an unavailable or inconsistent form: ${row.id} -> ${target.formId}`);
      }
    }
    if (typeof row.zMove === "string") {
      const signature = movesByID.get(toID(row.zMove));
      if (!signature?.isZ || !row.zMoveFrom || !movesByID.has(toID(row.zMoveFrom)) || !row.itemUser?.length) {
        throw new Error(`Incomplete signature Z eligibility: ${row.id}`);
      }
      // A crystal's source may mention a future/unavailable form. Emit only
      // eligible users, recording exclusions in the manifest, not a fake species.
      if (!row.itemUser.some((name) => speciesByID.has(toID(name)))) {
        unsupported.push("Signature Z crystal has no available species users.");
      }
    }
    return {
      id: row.id, name: row.name, description: row.description,
      megaStone: megaTargets.length === 1 ? megaTargets[0].formId : null,
      megaEvolves: megaTargets.length === 1 ? megaTargets[0].baseSpeciesId : null,
      megaTargets,
      ...(row.zMoveType ? { zMoveType: row.zMoveType } : {}),
      ...(typeof row.zMove === "string" ? { zMove: toID(row.zMove) } : {}),
      ...(row.zMoveFrom ? { zMoveFrom: toID(row.zMoveFrom) } : {}),
      ...(row.zMove && row.itemUser ? { itemUser: sorted(row.itemUser.map(toID).filter((id) => speciesByID.has(id))) } : {}),
      unsupported: sorted(unsupported),
    };
  });

  const moves = [...movesByID.values()].sort(byID).map((row): NativeMove => {
    const calc = engineMoves.get(row.id);
    const unsupported: string[] = [];
    if (!calc) unsupported.push(`Engine move missing: ${row.name}.`);
    if (calc && calc.type !== row.type) unsupported.push(`Engine move type differs: ${calc.type} vs ${row.type}.`);
    if (calc && calc.category !== row.category) {
      unsupported.push(`Engine move category differs: ${calc.category ?? "missing"} vs ${row.category}.`);
    }
    if (calc && calc.basePower !== row.basePower) unsupported.push(`Engine move power differs: ${calc.basePower} vs ${row.basePower}.`);
    if (calc && Boolean(calc.isZ) !== Boolean(row.isZ)) unsupported.push("Engine Z-Move flag differs.");
    if (calc && Boolean(calc.isMax) !== Boolean(row.isMax)) unsupported.push("Engine Max Move flag differs.");
    if (profile.gen === 7 && row.zMove?.basePower && calc?.zMove?.basePower !== row.zMove.basePower) {
      unsupported.push(`Engine Z-Move power differs: ${calc?.zMove?.basePower ?? "missing"} vs ${row.zMove.basePower}.`);
    }
    if (profile.gen === 8 && row.maxMove?.basePower && calc?.maxMove?.basePower !== row.maxMove.basePower) {
      unsupported.push(`Engine Max Move power differs: ${calc?.maxMove?.basePower ?? "missing"} vs ${row.maxMove.basePower}.`);
    }
    return {
      id: row.id, name: row.name, type: row.type, category: row.category, power: row.basePower,
      accuracy: typeof row.accuracy === "number" ? row.accuracy : null,
      priority: row.priority, target: row.target,
      multihit: Array.isArray(row.multihit) ? [...row.multihit] : row.multihit ?? null,
      ohko: Boolean(row.ohko), description: row.description,
      ...(row.isZ ? { isZ: true } : {}), ...(row.isMax ? { isMax: true } : {}),
      ...(profile.gen === 7 && row.zMove?.basePower ? { zMovePower: row.zMove.basePower } : {}),
      ...(profile.gen === 8 && row.maxMove?.basePower ? { maxMovePower: row.maxMove.basePower } : {}),
      unsupported: sorted(unsupported),
    };
  });
  const abilityIndex = new Map(abilities.map((row) => [row.id, row]));
  const itemIndex = new Map(items.map((row) => [row.id, row]));
  const species = eligible.map((row): NativeSpecies => {
    const calc = engineSpecies.get(engineSpeciesID(row, engineIDs));
    const unsupported: string[] = [];
    if (row.learnset.error) unsupported.push(`Native learnset resolution failed: ${row.learnset.error}`);
    if (!row.learnset.sources.length) unsupported.push("No resolved native learnset sources.");
    if (!calc) unsupported.push(`Engine species missing: ${row.name}.`);
    if (calc && JSON.stringify(calc.types) !== JSON.stringify(row.types)) {
      unsupported.push(`Engine species types differ: ${calc.types.join("/")} vs ${row.types.join("/")}.`);
    }
    for (const stat of STATS) {
      if (!Number.isFinite(row.baseStats[stat]) || row.baseStats[stat] <= 0) throw new Error(`Invalid base stat: ${row.id}.${stat}`);
      if (calc && calc.baseStats[stat] !== row.baseStats[stat]) {
        unsupported.push(`Engine base stat differs (${stat}): ${calc.baseStats[stat]} vs ${row.baseStats[stat]}.`);
      }
    }
    if (!Number.isFinite(row.weightkg) || row.weightkg <= 0) throw new Error(`Invalid weight: ${row.id}`);
    if (calc && calc.weightkg !== row.weightkg) unsupported.push(`Engine weight differs: ${calc.weightkg} vs ${row.weightkg} kg.`);
    if (calc?.gender && row.gender && calc.gender !== row.gender) {
      unsupported.push(`Engine fixed gender differs: ${calc.gender} vs ${row.gender}.`);
    }
    const canGigantamax = profile.gen === 8 && row.canGigantamax && !row.gmaxUnreleased ? toID(row.canGigantamax) : undefined;
    if (canGigantamax && calc && toID(calc.canGigantamax ?? "") !== canGigantamax &&
      !hintBySpecies.get(row.id)?.verifiedSignatureOverride) {
      unsupported.push("Engine Gigantamax signature differs from native game data.");
    }
    const abilityIDs = sorted(Object.values(row.abilities).map(toID));
    if (abilityIDs.every((id) => abilityIndex.get(id)!.unsupported.length)) {
      unsupported.push(`All assigned abilities unsupported: ${abilityIDs.join(", ")}.`);
    }
    const sourceRequirements = row.requiredItems ?? (row.requiredItem ? [row.requiredItem] : []);
    const requiredItems = sorted(sourceRequirements.map(toID).filter((id) => itemIndex.has(id)));
    if (sourceRequirements.length && !requiredItems.length) unsupported.push("No required item alternative is available in this game.");
    if (requiredItems.length && requiredItems.every((id) => itemIndex.get(id)!.unsupported.length)) {
      unsupported.push(`Required items unsupported: ${requiredItems.join(", ")}.`);
    }
    const moveIDs = sorted(row.learnset.movePool.filter((id) => {
      const move = movesByID.get(id);
      return move && !move.isZ && !move.isMax;
    }));
    if (moveIDs.includes("hiddenpower")) moveIDs.push(...typedHiddenPower);
    return {
      id: row.id, name: row.name, calcName: calc?.name ?? row.name,
      baseSpecies: toID(row.baseSpecies), types: [...row.types],
      baseStats: Object.fromEntries(STATS.map((stat) => [stat, row.baseStats[stat]])) as StatTable,
      weightkg: row.weightkg, abilities: abilityIDs, moves: sorted(moveIDs),
      battleForm: Boolean(row.battleOnly), requiredItem: requiredItems.length === 1 ? requiredItems[0] : null,
      ...(requiredItems.length ? { requiredItems } : {}),
      ...(row.gender ? { gender: row.gender } : {}),
      ...(canGigantamax ? { canGigantamax } : {}),
      ...(gmaxNames.has(row.id) ? { gmaxNames: gmaxNames.get(row.id)! } : {}),
      ...(profile.gen === 8 && row.cannotDynamax ? { cannotDynamax: true } : {}),
      ...(row.requiredMove ? { requiredMove: toID(row.requiredMove) } : {}),
      ...(profile.gen === 9 && row.requiredTeraType ? { requiredTeraType: row.requiredTeraType } : {}),
      ...(row.changesFrom && toID(row.changesFrom) !== row.id ? { changesFrom: toID(row.changesFrom) } : {}),
      ...(parents(row).length ? { battleOnly: sorted(parents(row).map(toID)) } : {}),
      unsupported: sorted(unsupported),
    };
  });
  const unsupportedSpecies = species.filter((row) => row.unsupported.length);
  const unsupportedMoves = moves.filter((row) => row.unsupported.length);
  const notes = [
    `Resolved Dex.mod('${profile.mod}') with complete ${source.ancestry.join(" -> ")} inheritance; nonstandard flags and available battleOnly parents define game availability, not tiers or competitive regulations.`,
    "Native getFullLearnset/getMovePool(false) is authoritative. Gen 7/8 retain eligible transfers (including HM/regional-evolution restrictions); Gen 9 applies HOME move reset. Inherited tables are valid native provenance, not Champions explicit-mod proof.",
    "Movepools are individual move availability, not a validator for inter-move/event/ability/level compatibility. Unavailable moves are omitted; Sketch follows the pinned source. Typed Hidden Power aliases expand only a proven Hidden Power pool and require separate innate-IV context at calculation time.",
    "Exact Showdown identities/stats/types/weight are retained. Only source-declared cosmetics and Aegislash's explicit Shield base forme can share an engine identity; there is no generic base-form fallback.",
    "Source-declared Gmax placeholders are represented by gmaxNames and canGigantamax on real SwSh species, never as zero-weight species or automatically active transformations. Future-game mechanic metadata is not activated by presence in inherited source data.",
    "Engine parity checks identity, types, category, power, base stats, weight, gender when present, Mega targets and applicable Z/Max power metadata. Presence/parity alone does not prove all ability/item effects or calculation mechanics; the application must gate context and unsupported mechanics.",
    "Status-Z bonuses, called moves, residual Gmax turns, multi-turn battle history and competitive origin/combination clauses are not simulated by this catalog. No Champions usage rankings are applied to native games.",
  ];
  for (const hint of hintDiscrepancies) {
    notes.push(`Engine species hint discrepancy (${hint.speciesId}.${hint.field}): ${hint.engineValue ?? "missing"} vs ${hint.sourceValue}. ${hint.resolution}`);
  }
  for (const [label, rows] of [
    ["Species with engine/data/provenance gaps", unsupportedSpecies],
    ["Moves with engine/data gaps", unsupportedMoves],
    ["Abilities with engine/source gaps", abilities.filter((row) => row.unsupported.length)],
    ["Items with engine/data gaps", items.filter((row) => row.unsupported.length)],
  ] as const) notes.push(`${label} (${rows.length}): ${rows.length ? rows.map((row) => row.id).join(", ") : "none"}.`);
  return {
    version: 1, game: profile.game, level: null,
    sources: { engine: { ...sources.engine }, showdown: { ...sources.showdown } },
    species, moves, abilities, items,
    coverage: {
      species: species.length, moves: moves.length,
      unsupportedSpecies: unsupportedSpecies.length, unsupportedMoves: unsupportedMoves.length, notes,
    },
  };
}
