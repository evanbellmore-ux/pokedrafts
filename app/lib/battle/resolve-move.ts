import { Generations, toID } from "@smogon/calc";
import { Move } from "@smogon/calc/dist/move";
import type { Pokemon } from "@smogon/calc";
import { HIDDEN_POWER_TYPES, hiddenPowerType, isMaxActive, stellarBoostUsedUp, validateMechanic } from "./mechanics";
import type { BattleRuntime } from "./runtime";
import type { BattleBuild, ChampionsMove, MoveContext } from "./types";

// Engine-only boundary: imported by calculate.ts, never by build/configuration
// helpers. Keep the calculator's initial preparation UI independent of the engine.
type Resolution =
  | { move: Move; effective: ChampionsMove; transformed: boolean; assumptions: string[]; kind?: never; reason?: never }
  | { kind: "unsupported" | "needs-context"; reason: string; move?: never; effective?: never; transformed?: never; assumptions?: never };

type MoveOptions = NonNullable<ConstructorParameters<typeof Move>[2]>;

// Pinned Showdown data/moves.ts:8646–8885 has exactly these typed placeholders;
// dex-moves.ts:479 and pokemon.ts:354–360 resolve them to canonical Hidden Power.
// Catalog IDs stay intact here, but manual/default selections need the same guards.
const HIDDEN_POWER_ALIASES = new Map<string, string>(
  HIDDEN_POWER_TYPES.map((type) => [`hiddenpower${type.toLowerCase()}`, type]),
);

/** Conversion rebuilds move data on clone, so a priority override must survive it. */
export function withResolvedPriority(move: Move, priority: number): Move {
  move.priority = priority;
  const clone = move.clone.bind(move);
  move.clone = () => withResolvedPriority(clone(), priority);
  return move;
}

/** Resolve the requested attack before applying base-move history/hit/failure guards. */
/** The question a Terastallized Stellar user's move asks until its first use of the type is set. */
export const STELLAR_FIRST_USE_REASON = "Stellar: first use of this move's type needed.";

export function resolveBattleMove(
  metadata: ChampionsMove,
  build: BattleBuild,
  pokemon: Pokemon,
  context: MoveContext | undefined,
  runtime: BattleRuntime,
  options: Pick<MoveOptions, "hits" | "isCrit" | "overrides"> = {},
): Resolution {
  const gen = Generations.get(runtime.profile.generation);
  const species = runtime.speciesById.get(build.speciesId);
  const item = runtime.itemsById.get(build.itemId);
  const assumptions: string[] = [];
  const fail = (reason: string): Resolution => ({ kind: "unsupported", reason });
  if (build.game !== runtime.profile.id) return fail("The build and battle game do not match.");
  const mechanicIssues = validateMechanic(build, runtime);
  if (mechanicIssues.length) return fail(mechanicIssues.map((issue) => issue.message).join(" "));
  if (context?.useZ !== undefined && typeof context.useZ !== "boolean") return fail("Z-Move activation must be on or off.");
  if (metadata.isZ || metadata.isMax) return fail("A Z-Move or Max Move cannot be assigned directly.");
  if (!gen.moves.get(toID(metadata.name))) return fail("This move is absent from the selected game's pinned engine.");
  const useZ = context?.useZ === true;
  const useMax = isMaxActive(build);
  const selectedHiddenPowerType = HIDDEN_POWER_ALIASES.get(metadata.id);
  const isHiddenPower = metadata.id === "hiddenpower" || selectedHiddenPowerType !== undefined;
  if (useZ) {
    if (!runtime.profile.zMoves) return fail(`Z-Moves are not available in ${runtime.profile.label}.`);
    if (build.mechanic) return fail("A Z-Move cannot be combined with another active battle mechanic.");
    if (species?.name.includes("-Mega")) return fail("A Mega-Evolved Pokémon cannot use a Z-Crystal.");
    if (!item?.zMoveType && !item?.zMove) return fail("A Z-Move requires the matching Z-Crystal.");
    if (item.itemUser?.length && !item.itemUser.includes(build.speciesId)) return fail(`${item.name} is not compatible with ${species?.name ?? build.speciesId}.`);
    // battle-actions.ts:1401–1420 checks the canonical Normal base move, not
    // its eventual innate type. Every typed alias therefore needs Normalium Z.
    if (item.zMoveFrom) {
      if (metadata.id !== item.zMoveFrom) return fail(`${item.name} requires ${runtime.movesById.get(item.zMoveFrom)?.name ?? item.zMoveFrom}.`);
    } else if (item.zMoveType !== (isHiddenPower ? "Normal" : metadata.type)) {
      return fail(`${item.name} does not match this base move's Z-Move type${isHiddenPower ? "; Hidden Power requires Normalium Z" : ""}.`);
    }
    if (metadata.category === "Status") return fail("Status Z-Moves are not calculated.");
    assumptions.push("Assumes the Z-Move is still unused.");
  }
  // Pinned Showdown battle-actions.ts getMaxMove maps every status move to Max
  // Guard. Calc omits maxMove on status data, so supply only the conversion marker.
  // Engine move-data properties are readonly: compose new override values instead
  // of mutating a Partial<Move> or weakening its public declaration.
  let overrides: MoveOptions["overrides"] = {
    ...options.overrides,
    ...(useMax && metadata.category === "Status" ? { maxMove: { basePower: 0 } } : {}),
  };
  // The engine types these Max Moves differently from pinned Showdown: Judgment and Revelation Dance
  // (the user's plate or type), Natural Gift (its berry), and Hangry Morpeko's Aura Wheel (Dark).
  // Weather Ball, Terrain Pulse, Multi-Attack, Techno Blast, Full Belly Aura Wheel and Liquid Voice
  // sound moves match (fix35/verify.ts).
  if (useMax && (["judgment", "naturalgift", "revelationdance"].includes(metadata.id) || (metadata.id === "aurawheel" && build.speciesId !== "morpeko"))) {
    return fail("This move's Max Move type is not verified.");
  }
  if (!useZ && !useMax && ["return", "frustration"].includes(metadata.id)) {
    const happiness = build.configuration?.happiness ?? 255;
    const basePower = Math.max(1, Math.floor((metadata.id === "return" ? happiness : 255 - happiness) * 10 / 25));
    overrides = { ...overrides, basePower };
    assumptions.push(`Happiness ${happiness}: ${metadata.name} has ${basePower} base power.`);
  }
  if (isHiddenPower && !useZ) {
    if (runtime.profile.generation !== 7 || build.game === "champions") return fail("Hidden Power is supported only in Ultra Sun/Ultra Moon.");
    const innate = build.native.innateIVs ?? build.native.ivs;
    const type = hiddenPowerType(innate);
    // A transformed Imposter user keeps its own Hidden Power type, from its own IVs (pinned Showdown
    // transformInto), and its copy of a typed Hidden Power is renamed to that type.
    const own = build.transformedFrom && (runtime.speciesById.get(build.transformedFrom.speciesId)?.name ?? build.transformedFrom.speciesId);
    const declared = build.configuration?.hiddenPowerType;
    if (!type || (selectedHiddenPowerType && type !== selectedHiddenPowerType) || (declared && type !== declared)) {
      if (own && type && (!declared || declared === type)) return { kind: "needs-context", reason: `Transform keeps ${own}'s Hidden Power type: Hidden Power ${type}.` };
      return { kind: "needs-context", reason: "Hidden Power's declared type does not match the innate IVs." };
    }
    const engineType = gen.types.get(toID(type));
    if (!engineType) return fail("Hidden Power's type is absent from the pinned engine.");
    overrides = { ...overrides, type: engineType.name, basePower: 60 };
    assumptions.push(`Hidden Power ${type}, 60 power${own ? ` (${own}'s own IVs)` : ""}.`);
  }
  let stellarFirstUse = context?.stellarFirstUse;
  if (build.mechanic === "tera" && build.configuration?.teraType === "Stellar" && metadata.category !== "Status") {
    if (!stellarBoostUsedUp(build, runtime)) {
      stellarFirstUse = true;
      assumptions.push("Terapagos-Stellar: Stellar boost on every use.");
    } else {
      if (typeof stellarFirstUse !== "boolean") return { kind: "needs-context", reason: STELLAR_FIRST_USE_REASON };
      assumptions.push(`Stellar: first use of this move's type — ${stellarFirstUse ? "yes" : "no"}.`);
    }
  }
  let overrideMove: MoveOptions["overrideMove"];
  if (build.mechanic === "gigantamax") {
    const signature = species?.canGigantamax ? runtime.movesById.get(species.canGigantamax) : undefined;
    const engineSignature = signature && gen.moves.get(toID(signature.name));
    if (!signature?.isMax || signature.unsupported.length || !engineSignature?.isMax || !signature.name.startsWith("G-Max ")) {
      return fail("No verified G-Max move for this species.");
    }
    overrideMove = engineSignature.name;
  }
  // The root Move declaration omits overrideMove. This inspected typed constructor
  // accepts it, and its clone() preserves it; no dependency patch or API cast.
  let move = new Move(gen, metadata.name, {
    ...options, overrides, ability: pokemon.ability, item: pokemon.item,
    useZ, useMax: useMax ? (build.mechanic === "gigantamax" ? "gmax" : true) : false,
    overrideMove, isStellarFirstUse: stellarFirstUse,
    timesUsed: 1, timesUsedWithMetronome: 0,
  });
  if (useZ && (!move.isZ || (item?.zMove && toID(move.name) !== item.zMove))) return fail("The engine did not produce the Z-Move.");
  // Revelation Dance's Z conversion uses its own Normal type (pinned Showdown battle-actions
  // getActiveZMove), but the engine would retype the Z-Move by the user's type, keyed on the base move's
  // name, so it is built under its Z name. Weather Ball takes its weather type before Z conversion, as
  // the engine does, so it is left alone.
  if (useZ && metadata.id === "revelationdance") {
    move = new Move(gen, move.name, {
      ...options, overrides: { basePower: move.bp, category: move.category }, ability: pokemon.ability, item: pokemon.item,
      timesUsed: 1, timesUsedWithMetronome: 0,
    });
    assumptions.push(`${move.name}: Normal type (from ${metadata.name}).`);
  }
  if (useMax && !move.isMax) return fail("The engine did not produce the Max Move.");
  const transformed = useZ || useMax;
  if (transformed) assumptions.push(useMax ? "One Max/G-Max attack." : "One Z-Move, once per battle.");
  const effective: ChampionsMove = {
    ...metadata, id: transformed ? toID(move.name) : metadata.id,
    name: move.name, type: move.type, power: move.bp, category: move.category,
    priority: move.priority, target: move.target,
    ...(transformed ? { multihit: null, ohko: false, unsupported: [] } : {}),
  };
  return { move, effective, transformed, assumptions };
}
