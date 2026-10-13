import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import EarlierTurnFields, { CarriedFields, EarlierFieldFields, EarlierTurnContext, type CarriedControl } from "@/app/(app)/calculator/EarlierTurnFields";
import {
  afterDoublesAction, afterDoublesField, applyDoublesEarlier, carriedAbilityOn, carriedOptions, clearSlotEarlier, EARLIER_TABLES, earlierFieldControls,
  earlierIssueTexts, earlierSideControls, earlierSlotControls, earlierTurnToggles, NO_CARRIED_OPTIONS, NO_HISTORY, NO_TURN_EARLIER, reconcileCarried,
  reconcileEarlier, setDoublesSwitchedIn, switchDoublesIn, withSlotHistory, withTurnEarlier,
  type DoublesSlotHistory, type DoublesTurnEarlier, type EarlierChange, type EarlierControl,
} from "@/app/(app)/calculator/doubles-inputs";
import { createDoubles, getDoublesTurnInput, type CalculatorState, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import styles from "@/app/(app)/calculator/calculator.module.css";
import { createMatchup } from "@/app/(app)/calculator/roster-prep";
import { positionalIn } from "../fixtures/naming";
import { CHARGE_TURN_MOVES, PROTECT_MOVES, SEMI_INVULNERABLE_MOVES } from "@/app/lib/battle/doubles-actions";
import { DOUBLES_SLOTS, doublesNames, slotSide, type DoublesCarried, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { HEALING_BERRIES } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, getBuildStats } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, ChampionsSpecies } from "@/app/lib/battle/types";
import { unmodelledBattleStates, unmodelledDoublesStates } from "@/app/lib/battle/unmodelled-states";

// status2 Track NU (ADDENDUM2 §5.2, IN §5, §9): the 2v2 calculator's earlier-turn controls. Every control's "Shown when"
// per game over the four runtimes, "or while set", the option lists (names, never positions), the mapping into the
// turn's input, the reset rules, the summary count, unique accessible names and the phone-width layout, and the 2v2 note.

const GAMES: readonly BattleGame[] = ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"];
const SV = "scarlet_violet", CH = "champions", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon";
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of GAMES) runtimes[game] = await loadBattleRuntime(game);
});

type Mon = {
  species: string; ability?: string; item?: string; status?: BattleBuild["status"]; action?: string | null; target?: DoublesSlotId | null; quick?: string[];
  mechanic?: BattleBuild["mechanic"]; gender?: "M" | "F"; abilityActive?: boolean; teraType?: string; hp?: number;
};
const DITTO: Mon = { species: "ditto", ability: "limber" };

/** A 2v2 matchup: Ditto (Limber, Transform only) in every slot `mons` leaves out; each Pokémon with its action and quick moves. */
function matchup(runtime: BattleRuntime, mons: Partial<Record<DoublesSlotId, Mon>>, extra: Partial<DoublesMatchup> = {}): DoublesMatchup {
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots };
  const actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const mon = mons[slot] ?? DITTO;
    const fresh = createBuild(mon.species, runtime);
    const configuration = mon.gender || mon.teraType ? { ...fresh.configuration, ...(mon.gender ? { gender: mon.gender } : {}), ...(mon.teraType ? { teraType: mon.teraType } : {}) } : fresh.configuration;
    const build: BattleBuild = {
      ...fresh,
      ...(mon.ability ? { abilityId: mon.ability } : {}),
      ...(mon.item !== undefined ? { itemId: mon.item } : {}),
      ...(mon.status ? { status: mon.status } : {}),
      ...(mon.mechanic ? { mechanic: mon.mechanic } : {}),
      ...(mon.abilityActive !== undefined ? { abilityActive: mon.abilityActive } : {}),
      ...(mon.hp !== undefined ? { currentHP: mon.hp } : {}),
      ...(configuration ? { configuration } : {}),
    } as BattleBuild;
    const quick = mon.quick ?? [];
    const moves = [0, 1, 2, 3].map((index) => ({ moveId: quick[index] ?? null, origin: "manual", gameType: "Doubles" })) as MoveSlots;
    slots[slot] = { ...slots[slot], build, moves };
    actions[slot] = { moveId: mon.action ?? null, target: mon.target ?? null };
  }
  return { ...base, slots, actions, ...extra };
}

const supported = (runtime: BattleRuntime) => runtime.catalog.species.filter((entry) => !entry.battleForm && !entry.unsupported.length);
/** A species of the game that learns `moveId` (and passes `test`); null when none does. */
function learner(runtime: BattleRuntime, moveId: string, test: (species: ChampionsSpecies) => boolean = () => true): string | null {
  if (!runtime.movesById.has(moveId)) return null;
  return supported(runtime).find((entry) => entry.moves.includes(moveId) && test(entry))?.id ?? null;
}
function holder(runtime: BattleRuntime, abilityId: string, test: (species: ChampionsSpecies) => boolean = () => true): string | null {
  return supported(runtime).find((entry) => entry.abilities.includes(abilityId) && test(entry))?.id ?? null;
}
const typed = (type: string) => (species: ChampionsSpecies) => species.types.includes(type);
const damaging = (runtime: BattleRuntime, speciesId: string) => runtime.speciesById.get(speciesId)!.moves.find((id) => {
  const move = runtime.movesById.get(id);
  return move && move.category !== "Status" && !move.isZ && !move.isMax && !EARLIER_TABLES.twoTurn.has(id);
})!;

const controls = (doubles: DoublesMatchup, slot: DoublesSlotId = "own-left") => earlierSlotControls(doubles, slot);
const control = (doubles: DoublesMatchup, key: string, slot: DoublesSlotId = "own-left") => controls(doubles, slot).find((entry) => entry.key === key);
const sideControl = (doubles: DoublesMatchup, key: string, side: DoublesSideId = "own") => earlierSideControls(doubles, side).find((entry) => entry.key === key);
const fieldControl = (doubles: DoublesMatchup, key: string) => [...earlierFieldControls(doubles, "weather"), ...earlierFieldControls(doubles, "shared")].find((entry) => entry.key === key);
/** The control's change applied to `doubles`: a checkbox ticked, a select's or a number's value. */
function apply(doubles: DoublesMatchup, entry: EarlierControl | undefined, value: boolean | string | number | null): DoublesMatchup {
  if (!entry) throw new Error("no such control");
  const change: EarlierChange = entry.kind === "check" ? entry.set(value as boolean) : entry.kind === "select" ? entry.set(value as string) : entry.set(value as number | null);
  return change(doubles);
}
const fieldWith = (runtime: BattleRuntime, patch: Partial<BattleConditions>) => ({ field: { ...createDoubles(0, runtime).field, ...patch } });

/** One control: where it shows (`shown`: the matchup and slot; null when the game has nothing that reads it) and a matchup that does not. */
type Case = {
  key: string;
  /** ADDENDUM2 §5.2's Games column (the games where the reader exists). */
  games: readonly BattleGame[];
  where?: "slot" | "side" | "field";
  shown: (runtime: BattleRuntime) => DoublesMatchup | null;
  hidden: (runtime: BattleRuntime) => DoublesMatchup | null;
};
const ALL = GAMES;
const at = (species: string | null, mon: Omit<Mon, "species"> = {}): Mon | null => species ? { species, ...mon } : null;
/** A matchup with `mons` (each placed only when found), or null when one of them is missing. */
function placed(runtime: BattleRuntime, mons: Partial<Record<DoublesSlotId, Mon | null>>, extra: Partial<DoublesMatchup> = {}): DoublesMatchup | null {
  if (Object.values(mons).some((mon) => mon === null)) return null;
  return matchup(runtime, mons as Partial<Record<DoublesSlotId, Mon>>, extra);
}
const withCarried = (doubles: DoublesMatchup | null, slot: DoublesSlotId, carried: DoublesCarried) => doubles && { ...doubles, carried: { ...doubles.carried, [slot]: carried } };
const withHistory = (doubles: DoublesMatchup | null, slot: DoublesSlotId, history: DoublesSlotHistory) => doubles && { ...doubles, history: { ...doubles.history, [slot]: history } };

const CASES: Case[] = [
  // ---- per Pokémon, checkboxes ----
  { key: "chargedLast", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "dig"), { action: "dig" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "dig")) }) },
  { key: "destinyBond", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "destinybond")) }), hidden: (r) => matchup(r, {}) },
  { key: "minimized", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "minimize")) }), hidden: (r) => matchup(r, {}) },
  { key: "glaiveRush", games: [SV, CH], shown: (r) => placed(r, { "own-left": at(learner(r, "glaiverush")) }), hidden: (r) => matchup(r, {}) },
  {
    key: "laserFocus", games: [SWSH, USUM],
    shown: (r) => { const id = learner(r, "laserfocus"); return id ? matchup(r, { "own-left": { species: id, action: damaging(r, id) } }) : null; },
    hidden: (r) => { const id = learner(r, "laserfocus"); return id ? matchup(r, { "own-left": { species: id } }) : null; },
  },
  { key: "recharge", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "hyperbeam")) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "hyperbeam"), { action: "hyperbeam" }) }) },
  { key: "notFirstTurn", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "fakeout"), { action: "fakeout", target: "opponent-left" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "fakeout")) }) },
  {
    key: "raisedEarlier", games: [SV, CH, SWSH],
    shown: (r) => placed(r, { "opponent-left": at(learner(r, "burningjealousy"), { action: "burningjealousy" }) }),
    hidden: (r) => placed(r, { "opponent-left": at(learner(r, "burningjealousy")) }),
  },
  {
    key: "itemEarlier", games: ALL,
    shown: (r) => withHistory(placed(r, { "opponent-left": at(holder(r, "pickup"), { ability: "pickup", item: "" }) }), "own-left", { lastItem: "sitrusberry" }),
    hidden: (r) => placed(r, { "opponent-left": at(holder(r, "pickup"), { ability: "pickup", item: "" }) }),
  },
  { key: "tarShot", games: [SV, SWSH], shown: (r) => placed(r, { "opponent-left": at(learner(r, "tarshot")) }), hidden: (r) => matchup(r, {}) },
  {
    key: "foresight", games: [USUM],
    shown: (r) => placed(r, { "own-left": at(holder(r, "levitate", typed("Ghost")) ?? "gengar"), "opponent-left": at(learner(r, "foresight")) }),
    hidden: (r) => placed(r, { "opponent-left": at(learner(r, "foresight")) }),
  },
  {
    key: "miracleEye", games: [USUM],
    shown: (r) => placed(r, { "own-left": at(supported(r).find(typed("Dark"))?.id ?? null), "opponent-left": at(learner(r, "miracleeye")) }),
    hidden: (r) => placed(r, { "opponent-left": at(learner(r, "miracleeye")) }),
  },
  {
    key: "nightmare", games: [USUM],
    shown: (r) => placed(r, { "own-left": { ...DITTO, status: "slp" }, "opponent-left": at(learner(r, "nightmare")) }),
    hidden: (r) => placed(r, { "opponent-left": at(learner(r, "nightmare")) }),
  },
  { key: "healBlock", games: [SV, CH, USUM], shown: (r) => placed(r, { "opponent-left": at(learner(r, "psychicnoise") ?? learner(r, "healblock")) }), hidden: (r) => matchup(r, {}) },
  { key: "berryLocked", games: ALL, shown: (r) => placed(r, { "own-left": at(holder(r, "berserk"), { ability: "berserk", item: "sitrusberry" }) }), hidden: (r) => placed(r, { "own-left": at(holder(r, "berserk"), { ability: "berserk", item: "" }) }) },
  { key: "powerTrick", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "powertrick")) }), hidden: (r) => matchup(r, {}) },
  { key: "noRetreat", games: [SV, CH, SWSH], shown: (r) => placed(r, { "own-left": at(learner(r, "noretreat"), { action: "noretreat" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "noretreat")) }) },
  { key: "battleBond", games: [SV], shown: (r) => placed(r, { "own-left": at(holder(r, "battlebond"), { ability: "battlebond" }) }), hidden: (r) => matchup(r, {}) },
  {
    key: "defenseCurl", games: [SV, SWSH, USUM],
    shown: (r) => placed(r, { "own-left": at(learner(r, "rollout") ?? learner(r, "iceball"), { action: learner(r, "rollout") ? "rollout" : "iceball" }) }),
    hidden: (r) => placed(r, { "own-left": at(learner(r, "rollout")) }),
  },
  {
    key: "bideRelease", games: [USUM],
    shown: (r) => withCarried(placed(r, { "own-left": at(learner(r, "bide"), { action: "bide" }) }), "own-left", { bide: { stored: 40, source: "opponent-left", release: false } }),
    hidden: (r) => placed(r, { "own-left": at(learner(r, "bide"), { action: "bide" }) }),
  },
  { key: "drowsy", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "yawn")) }), hidden: (r) => placed(r, { "own-left": { ...DITTO, status: "par" }, "opponent-left": at(learner(r, "yawn")) }) },
  { key: "saltCure", games: [SV, CH], shown: (r) => placed(r, { "opponent-left": at(learner(r, "saltcure")) }), hidden: (r) => placed(r, { "own-right": at(learner(r, "saltcure")) }) },
  { key: "aquaRing", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "aquaring")) }), hidden: (r) => matchup(r, {}) },
  { key: "ingrain", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "ingrain")) }), hidden: (r) => matchup(r, {}) },
  { key: "curse", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "curse", typed("Ghost"))) }), hidden: (r) => placed(r, { "opponent-left": at(learner(r, "curse", (entry) => !entry.types.includes("Ghost"))) }) },
  // ---- per Pokémon, selects ----
  { key: "stockpile", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "stockpile"), { action: "stockpile" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "stockpile")) }) },
  { key: "type", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "soak")) }), hidden: (r) => matchup(r, {}) },
  { key: "addedType", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "forestscurse") ?? learner(r, "trickortreat")) }), hidden: (r) => matchup(r, {}) },
  {
    key: "attract", games: ALL,
    shown: (r) => placed(r, { "own-left": { species: "snorlax", gender: "M" }, "opponent-left": at(learner(r, "attract", (entry) => !entry.gender), { gender: "F" }) }),
    hidden: (r) => placed(r, { "own-left": { species: "snorlax", gender: "M" }, "opponent-left": at(learner(r, "attract", (entry) => !entry.gender), { gender: "M" }) }),
  },
  { key: "embargo", games: [USUM], shown: (r) => placed(r, { "opponent-left": at(learner(r, "embargo")) }), hidden: (r) => matchup(r, {}) },
  { key: "telekinesis", games: [USUM], shown: (r) => placed(r, { "opponent-left": at(learner(r, "telekinesis")) }), hidden: (r) => matchup(r, {}) },
  { key: "octolock", games: [CH, SWSH], shown: (r) => placed(r, { "opponent-left": at(learner(r, "octolock")) }), hidden: (r) => placed(r, { "own-right": at(learner(r, "octolock")) }) },
  { key: "accuracy", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "storedpower"), { action: "storedpower", target: "opponent-left" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "storedpower")) }) },
  { key: "evasion", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "psychup"), { action: "psychup", target: "own-left" }) }), hidden: (r) => placed(r, { "opponent-left": at(learner(r, "psychup"), { action: "psychup", target: "own-right" }) }) },
  { key: "lockOn", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "lockon") ?? learner(r, "mindreader")) }), hidden: (r) => matchup(r, {}) },
  { key: "lastMove", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "encore"), { action: "encore", target: "own-left" }) }), hidden: (r) => placed(r, { "opponent-left": at(learner(r, "encore")) }) },
  {
    key: "lastTarget", games: ALL,
    shown: (r) => withHistory(placed(r, { "opponent-left": at(learner(r, "instruct"), { action: "instruct", target: "own-left" }) }), "own-left", { lastMove: "transform" }),
    hidden: (r) => withHistory(placed(r, { "opponent-left": at(learner(r, "instruct"), { action: "instruct", target: "own-left" }) }), "own-left", { lastMove: null }),
  },
  { key: "lastItem", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "recycle"), { action: "recycle", item: "" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "recycle"), { action: "recycle", item: "leftovers" }) }) },
  { key: "cudChew", games: [SV, CH], shown: (r) => placed(r, { "own-left": at(holder(r, "cudchew"), { ability: "cudchew" }) }), hidden: (r) => matchup(r, {}) },
  { key: "stall", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "protect"), { action: "protect" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "protect")) }) },
  { key: "allySwitch", games: [SV, CH], shown: (r) => placed(r, { "own-left": at(learner(r, "allyswitch"), { action: "allyswitch" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "allyswitch")) }) },
  { key: "uproar", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "uproar"), { action: "uproar" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "uproar")) }) },
  { key: "furyCutter", games: [SV, SWSH, USUM], shown: (r) => placed(r, { "own-left": at(learner(r, "furycutter"), { action: "furycutter", target: "opponent-left" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "furycutter")) }) },
  { key: "rollout", games: [SV, SWSH, USUM], shown: (r) => placed(r, { "own-left": at(learner(r, "rollout"), { action: "rollout", target: "opponent-left" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "rollout")) }) },
  { key: "ppLeft", games: [USUM], shown: (r) => placed(r, { "own-left": at(learner(r, "trumpcard"), { action: "trumpcard", target: "opponent-left" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "trumpcard")) }) },
  { key: "bideStored", games: [USUM], shown: (r) => placed(r, { "own-left": at(learner(r, "bide"), { action: "bide" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "bide")) }) },
  {
    key: "bideFrom", games: [USUM],
    shown: (r) => withCarried(placed(r, { "own-left": at(learner(r, "bide"), { action: "bide" }) }), "own-left", { bide: { stored: 0, source: null, release: false } }),
    hidden: (r) => placed(r, { "own-left": at(learner(r, "bide"), { action: "bide" }) }),
  },
  { key: "futureMove", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "futuresight") ?? learner(r, "doomdesire")) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "futuresight")) }) },
  { key: "leechSeed", games: ALL, shown: (r) => placed(r, { "opponent-left": at(learner(r, "leechseed")) }), hidden: (r) => placed(r, { "own-left": at(supported(r).find(typed("Grass"))?.id ?? null), "opponent-left": at(learner(r, "leechseed")) }) },
  { key: "perish", games: ALL, shown: (r) => placed(r, { "own-right": at(learner(r, "perishsong")) }), hidden: (r) => matchup(r, {}) },
  { key: "trap", games: ALL, shown: (r) => placed(r, { "own-right": at(learner(r, "firespin")) }), hidden: (r) => matchup(r, {}) },
  { key: "syrupBomb", games: [SV, CH], shown: (r) => placed(r, { "opponent-right": at(learner(r, "syrupbomb")) }), hidden: (r) => matchup(r, {}) },
  { key: "wish", games: ALL, shown: (r) => placed(r, { "own-right": at(learner(r, "wish")) }), hidden: (r) => placed(r, { "opponent-left": at(learner(r, "wish")) }) },
  // ---- sides ----
  { key: "attackerSide.safeguard", where: "side", games: ALL, shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "attackerSide.mist", where: "side", games: [SV, SWSH, USUM], shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "attackerSide.luckyChant", where: "side", games: [USUM], shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "attackerSide.gmaxResidual.gmaxvinelash", where: "side", games: [SWSH], shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "noBench", where: "side", games: ALL, shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "faintedLast", where: "side", games: [SV, SWSH, USUM], shown: (r) => placed(r, { "own-right": at(learner(r, "retaliate"), { action: "retaliate", target: "opponent-left" }) }), hidden: (r) => placed(r, { "opponent-right": at(learner(r, "retaliate"), { action: "retaliate", target: "own-left" }) }) },
  // ---- the field ----
  { key: "weatherEnds", where: "field", games: ALL, shown: (r) => matchup(r, {}, fieldWith(r, { weather: "Rain" })), hidden: (r) => matchup(r, {}, fieldWith(r, { weather: "Heavy Rain" })) },
  { key: "terrainEnds", where: "field", games: ALL, shown: (r) => matchup(r, {}, fieldWith(r, { terrain: "Misty" })), hidden: (r) => matchup(r, {}) },
  { key: "mudSport", where: "field", games: [USUM], shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "waterSport", where: "field", games: [USUM], shown: (r) => matchup(r, {}), hidden: () => null },
  { key: "gravityEnds", where: "field", games: ALL, shown: (r) => matchup(r, {}, fieldWith(r, { gravity: true })), hidden: (r) => matchup(r, {}) },
  { key: "magicRoomEnds", where: "field", games: ALL, shown: (r) => matchup(r, {}, fieldWith(r, { magicRoom: true })), hidden: (r) => matchup(r, {}) },
  {
    key: "enteredFirst", where: "field", games: ALL,
    shown: (r) => placed(r, { "own-left": at(holder(r, "lightningrod"), { ability: "lightningrod" }), "opponent-left": at(holder(r, "lightningrod"), { ability: "lightningrod" }) }),
    hidden: (r) => placed(r, { "own-left": at(holder(r, "lightningrod"), { ability: "lightningrod" }) }),
  },
  { key: "battleLastMove", where: "field", games: ALL, shown: (r) => placed(r, { "own-left": at(learner(r, "copycat"), { action: "copycat" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "copycat")) }) },
  { key: "echoedVoice", where: "field", games: [SV, SWSH, USUM], shown: (r) => placed(r, { "own-left": at(learner(r, "echoedvoice"), { action: "echoedvoice" }) }), hidden: (r) => placed(r, { "own-left": at(learner(r, "echoedvoice")) }) },
];

const lookup = (entry: Case, doubles: DoublesMatchup) => entry.where === "side" ? sideControl(doubles, entry.key)
  : entry.where === "field" ? fieldControl(doubles, entry.key) : control(doubles, entry.key);

describe("2v2 earlier-turn controls: shown when the turn reads them (ADDENDUM2 §5.2)", () => {
  for (const entry of CASES) {
    it(`${entry.key}: shown in ${entry.games.join(", ")} only`, () => {
      for (const game of GAMES) {
        const runtime = runtimes[game];
        const shown = entry.shown(runtime);
        if (entry.games.includes(game)) {
          expect(shown, `${entry.key} in ${game}: a setter exists`).not.toBeNull();
          expect(lookup(entry, shown!), `${entry.key} shown in ${game}`).toBeDefined();
          const hidden = entry.hidden(runtime);
          if (hidden) expect(lookup(entry, hidden), `${entry.key} hidden in ${game}`).toBeUndefined();
        } else if (shown) {
          expect(lookup(entry, shown), `${entry.key} not in ${game}`).toBeUndefined();
        }
      }
    });
  }

  it("shows the Alluring Voice reader on every Pokémon it can reach, Burning Jealousy's on the user's foes only", () => {
    const runtime = runtimes[SV];
    const voice = matchup(runtime, { "opponent-left": { species: learner(runtime, "alluringvoice")!, action: "alluringvoice", target: "own-left" } });
    expect(["own-left", "own-right", "opponent-right"].map((slot) => !!control(voice, "raisedEarlier", slot as DoublesSlotId))).toEqual([true, true, true]);
    const jealousy = matchup(runtime, { "opponent-left": { species: learner(runtime, "burningjealousy")!, action: "burningjealousy" } });
    expect(["own-left", "own-right", "opponent-right"].map((slot) => !!control(jealousy, "raisedEarlier", slot as DoublesSlotId))).toEqual([true, true, false]);
  });

  it("offers no charge control for a Z-Move or Max Move, nor for Sky Drop", () => {
    const usum = runtimes[USUM];
    const flyer = learner(usum, "fly")!;
    const z = matchup(usum, { "own-left": { species: flyer, action: "fly" } });
    expect(control(z, "chargedLast")?.label).toBe("Fly charged last turn");
    const asZ = { ...z, slots: { ...z.slots, "own-left": { ...z.slots["own-left"], contexts: { fly: { useZ: true } } } } };
    expect(control(asZ, "chargedLast")).toBeUndefined();
    const swsh = runtimes[SWSH];
    const max = matchup(swsh, { "own-left": { species: learner(swsh, "dig")!, action: "dig", mechanic: "dynamax" } });
    expect(control(max, "chargedLast")).toBeUndefined();
    const skyDrop = matchup(usum, { "own-left": { species: learner(usum, "skydrop")!, action: "skydrop", target: "opponent-left" } });
    expect(control(skyDrop, "chargedLast")).toBeUndefined();
  });

  it("asks Protecting moves in a row of a Dynamaxed status move (Max Guard) and of Endure", () => {
    const swsh = runtimes[SWSH];
    const id = learner(swsh, "swordsdance")!;
    expect(control(matchup(swsh, { "own-left": { species: id, action: "swordsdance", mechanic: "dynamax" } }), "stall")).toBeDefined();
    expect(control(matchup(swsh, { "own-left": { species: id, action: "swordsdance" } }), "stall")).toBeUndefined();
    expect(control(matchup(swsh, { "own-left": { species: learner(swsh, "endure")!, action: "endure" } }), "stall")).toBeDefined();
  });

  it("keeps Type at Unknown for a used Protean or Libero, and shows no type control under a Tera type or on Arceus", () => {
    const sv = runtimes[SV];
    const protean = holder(sv, "protean")!;
    const used = matchup(sv, { "own-left": { species: protean, ability: "protean", abilityActive: false } });
    const type = control(used, "type");
    expect(type).toMatchObject({ kind: "select", value: "" });
    expect(type?.kind === "select" && type.choices[0]).toEqual({ value: "", label: "Unknown" });
    // Any pick, its own type included, gives the types.
    const own = sv.speciesById.get(protean)!.types;
    const picked = apply(used, type, own[0]);
    expect(picked.history["own-left"]).toMatchObject({ types: own, typesOf: protean });
    expect(control(picked, "type")).toMatchObject({ value: own[0], toggle: false });
    // Unused: its own types, and its own pair is no answer.
    const unused = matchup(sv, { "own-left": { species: protean, ability: "protean", abilityActive: true } });
    expect(control(unused, "type")).toMatchObject({ value: own[0] });
    expect(apply(unused, control(unused, "type"), own[0]).history["own-left"]).toBe(NO_HISTORY);
    const water = apply(unused, control(unused, "type"), "Water");
    expect(water.history["own-left"]).toEqual({ types: own[1] ? ["Water", own[1]] : ["Water"], typesOf: protean });
    expect(control(water, "type")?.toggle).toBe(true);
    // A Tera type other than Stellar replaces its types: no control (Stellar keeps them).
    expect(control(matchup(sv, { "own-left": { species: protean, ability: "protean", mechanic: "tera", teraType: "Fire" } }), "type")).toBeUndefined();
    expect(control(matchup(sv, { "own-left": { species: protean, ability: "protean", mechanic: "tera", teraType: "Stellar" } }), "type")).toBeDefined();
    const arceus = supported(sv).find((entry) => entry.id.startsWith("arceus"));
    if (arceus) expect(control(matchup(sv, { "own-left": { species: arceus.id }, "opponent-left": { species: learner(sv, "soak")! } }), "type")).toBeUndefined();
  });
});

describe("2v2 earlier-turn controls: or while set, a fainted Pokémon shows none", () => {
  it("keeps a set control shown after its reader goes", () => {
    const runtime = runtimes[SV];
    const protect = learner(runtime, "protect")!;
    let doubles = matchup(runtime, { "own-left": { species: protect, action: "protect" } });
    doubles = apply(doubles, control(doubles, "stall"), "2");
    expect(doubles.carried["own-left"]).toEqual({ stall: 9 });
    const moved = { ...doubles, actions: { ...doubles.actions, "own-left": { moveId: null, target: null } } };
    expect(control(moved, "stall")).toMatchObject({ value: "2" });
    const seeded = withCarried(matchup(runtime, {}), "own-left", { minimize: true, leechSeed: "opponent-left", attract: "opponent-right" })!;
    expect(control(seeded, "minimized")).toMatchObject({ checked: true });
    expect(control(seeded, "leechSeed")).toMatchObject({ value: "opponent-left" });
    const attract = control(seeded, "attract");
    expect(attract?.kind === "select" && attract.choices.find((choice) => choice.value === "opponent-right")?.label).toBe("Ditto (opponent's, 2)");
    const ended = withTurnEarlierState(matchup(runtime, {}), { faintedLastTurn: { own: true } });
    expect(sideControl(ended, "faintedLast")).toMatchObject({ value: "yes" });
  });

  it("shows nothing for a Pokémon that has fainted, though it keeps its state", () => {
    const runtime = runtimes[SV];
    const doubles = withCarried(matchup(runtime, { "own-left": { species: learner(runtime, "minimize")!, hp: 0 } }), "own-left", { minimize: true })!;
    expect(controls(doubles)).toEqual([]);
    expect(doubles.carried["own-left"]).toEqual({ minimize: true });
    expect(earlierTurnToggles(doubles)).toBe(0);
  });
});

function withTurnEarlierState(doubles: DoublesMatchup, turnEarlier: DoublesTurnEarlier): DoublesMatchup {
  return { ...doubles, turnEarlier };
}

/** Every control a matchup shows: each Pokémon's, each side's and the field's. */
function everyControl(doubles: DoublesMatchup): EarlierControl[] {
  return [
    ...DOUBLES_SLOTS.flatMap((slot) => earlierSlotControls(doubles, slot)),
    ...earlierSideControls(doubles, "own"), ...earlierSideControls(doubles, "opponent"),
    ...earlierFieldControls(doubles, "weather"), ...earlierFieldControls(doubles, "shared"),
  ];
}

/** A turn that reads many controls at once (Swalot's group is the busiest), in each game where its Pokémon exist. */
function busy(runtime: BattleRuntime): DoublesMatchup {
  const swalot = runtime.speciesById.has("swalot") ? "swalot" : learner(runtime, "stockpile")!;
  const mons: Partial<Record<DoublesSlotId, Mon>> = {
    "own-left": { species: swalot, action: "stockpile", item: "", gender: "M" },
    "own-right": { species: learner(runtime, "perishsong") ?? "ditto", ability: undefined },
    "opponent-left": { species: learner(runtime, "encore", (entry) => entry.moves.includes("yawn")) ?? learner(runtime, "encore")!, action: "encore", target: "own-left", gender: "F" },
    "opponent-right": { species: learner(runtime, "leechseed", (entry) => entry.moves.includes("attract") && !entry.gender) ?? learner(runtime, "leechseed")!, gender: "F" },
  };
  return matchup(runtime, mons, fieldWith(runtime, { weather: "Rain", terrain: "Grassy", gravity: true, magicRoom: true }));
}

describe("2v2 earlier-turn controls: labels and options name Pokémon, never positions", () => {
  it("states facts with names in every label and option, in every game", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const doubles = busy(runtime);
      const all = everyControl(doubles);
      expect(all.length).toBeGreaterThan(8);
      for (const entry of all) {
        const texts = [entry.label, ...(entry.kind === "select" ? entry.choices.map((choice) => choice.label) : [])];
        for (const text of texts) {
          // "left" only as in "No Pokémon left to switch in" (none remaining), never a place.
          expect(positionalIn(text), `${game} ${entry.key}`).toEqual([]);
          expect(text.replace("Pokémon left to switch in", ""), `${game} ${entry.key}`).not.toMatch(/\b(left|right|slot|position)\b/i);
          expect(text, `${game} ${entry.key}`).not.toMatch(/\b(own|opponent)-(left|right)\b/);
          expect(text, `${game} ${entry.key}`).not.toMatch(/Click|Choose|Select|to see|browse/);
        }
      }
      // A slot-valued option is labelled by doublesNames.
      const leech = all.find((entry) => entry.key === "leechSeed" && entry.attrValue === "own-left");
      expect(leech?.kind === "select" && leech.choices.map((choice) => choice.label).slice(1)).toEqual(
        ["opponent-left", "opponent-right", "own-right"].map((slot) => `Heals ${namesOf(doubles)[slot as DoublesSlotId]}`));
    }
  });

  it("lists Last move's choices as Unknown, None since it came in, its quick moves and its action's move", () => {
    const runtime = runtimes[SV];
    const doubles = matchup(runtime, {
      "own-left": { species: learner(runtime, "protect", (entry) => entry.moves.includes("tackle"))!, quick: ["protect", "tackle"], action: "protect" },
      "opponent-left": { species: learner(runtime, "encore")!, action: "encore", target: "own-left" },
    });
    const last = control(doubles, "lastMove");
    expect(last?.kind === "select" && last.choices.map((choice) => choice.label)).toEqual(["Unknown", "None since it came in", "Protect", "Tackle"]);
    expect(last).toMatchObject({ value: "", toggle: false });
  });

  it("lists Item used earlier with Berries first, and only Berries for Harvest", () => {
    const runtime = runtimes[SV];
    const recycler = matchup(runtime, { "own-left": { species: learner(runtime, "recycle")!, action: "recycle", item: "" } });
    const item = control(recycler, "lastItem");
    if (item?.kind !== "select") throw new Error("no Item used earlier");
    const ids = item.choices.slice(2).map((choice) => choice.value);
    const firstOther = ids.findIndex((id) => !id.endsWith("berry"));
    expect(firstOther).toBeGreaterThan(0);
    expect(ids.slice(firstOther).every((id) => !id.endsWith("berry"))).toBe(true);
    expect(item.choices.slice(0, 2)).toEqual([{ value: "", label: "Unknown" }, { value: "none", label: "None" }]);
    const harvester = matchup(runtime, { "own-left": { species: holder(runtime, "harvest")!, ability: "harvest", item: "" } });
    const berries = control(harvester, "lastItem");
    expect(berries?.kind === "select" && berries.choices.slice(2).every((choice) => choice.value.endsWith("berry"))).toBe(true);
  });

  it("offers Lands this turn per learner, Future Sight first", () => {
    const runtime = runtimes[SV];
    const both = learner(runtime, "futuresight", (entry) => entry.moves.includes("doomdesire"));
    const seer = both ?? learner(runtime, "futuresight")!;
    const doubles = matchup(runtime, { "opponent-left": { species: seer } });
    const lands = control(doubles, "futureMove");
    const names = namesOf(doubles);
    expect(lands?.kind === "select" && lands.choices.map((choice) => choice.label)).toEqual(
      ["None", `Future Sight from ${names["opponent-left"]}`, ...(both ? [`Doom Desire from ${names["opponent-left"]}`] : [])]);
  });
});

const namesOf = (doubles: DoublesMatchup) => doublesNames(doubles.slots, doubles.runtime);

describe("2v2 earlier-turn controls: the mapping into the turn's input (IN §5.4)", () => {
  it("writes each per-Pokémon control into its carried field or the slot input", () => {
    const sv = runtimes[SV];
    const usum = runtimes[USUM];
    const input = (doubles: DoublesMatchup, slot: DoublesSlotId = "own-left") => getDoublesTurnInput(doubles).pokemon[slot]!;
    const dig = matchup(sv, { "own-left": { species: learner(sv, "dig")!, action: "dig", target: "opponent-left" } });
    expect(input(apply(dig, control(dig, "chargedLast"), true)).carried).toEqual({ charging: "dig" });
    const protect = matchup(sv, { "own-left": { species: learner(sv, "protect")!, action: "protect" } });
    // —: absent (the turn's fact); 0: 1 (none last turn, no assumption); n: 3^n, at most 729.
    expect(input(apply(protect, control(protect, "stall"), "0")).carried).toEqual({ stall: 1 });
    expect(input(apply(protect, control(protect, "stall"), "6")).carried).toEqual({ stall: 729 });
    expect(input(apply(apply(protect, control(protect, "stall"), "1"), control(apply(protect, control(protect, "stall"), "1"), "stall"), "")).carried).toBeUndefined();
    const stockpile = matchup(sv, { "own-left": { species: learner(sv, "stockpile")!, action: "stockpile" } });
    // Layers only, no counts (C17).
    expect(input(apply(stockpile, control(stockpile, "stockpile"), "2")).carried).toEqual({ stockpile: { layers: 2 } });
    const fakeout = matchup(sv, { "own-left": { species: learner(sv, "fakeout")!, action: "fakeout", target: "opponent-left" } });
    expect(input(apply(fakeout, control(fakeout, "notFirstTurn"), true))).toMatchObject({ firstTurn: false });
    const jealous = matchup(sv, { "opponent-left": { species: learner(sv, "burningjealousy")!, action: "burningjealousy" } });
    expect(input(apply(jealous, control(jealous, "raisedEarlier"), true)).earlierThisTurn).toEqual({ statsRaised: true });
    const encore = matchup(sv, { "opponent-left": { species: learner(sv, "encore")!, action: "encore", target: "own-left" } });
    const unknown = input(encore);
    expect(unknown).not.toHaveProperty("lastMove");
    expect(input(apply(encore, control(encore, "lastMove"), "none")).lastMove).toBeNull();
    expect(input(apply(encore, control(encore, "lastMove"), "transform")).lastMove).toBe("transform");
    const soak = matchup(sv, { "opponent-left": { species: learner(sv, "soak")! } });
    const watered = apply(soak, control(soak, "type"), "Water");
    expect(input(watered).build.types).toEqual(["Water"]);
    // IN-C6: only the turn input's build copy has them; the Combatant's build does not.
    expect(watered.slots["own-left"].build).not.toHaveProperty("types");
    const healBlock = matchup(usum, { "opponent-left": { species: learner(usum, "healblock")! } });
    expect(input(apply(healBlock, control(healBlock, "healBlock"), "3")).carried).toEqual({ healBlock: 3 });
    const psychic = matchup(sv, { "opponent-left": { species: learner(sv, "psychicnoise")! } });
    expect(input(apply(psychic, control(psychic, "healBlock"), true)).carried).toEqual({ healBlock: 1 });
    const seer = matchup(sv, { "opponent-left": { species: learner(sv, "futuresight")! } });
    expect(input(apply(seer, control(seer, "futureMove"), "futuresight:opponent-left")).carried).toEqual({ futureMove: { move: "futuresight", source: "opponent-left" } });
    const trapper = learner(sv, "firespin")!;
    const trap = matchup(sv, { "opponent-left": { species: trapper, item: "bindingband", quick: ["firespin"] } });
    expect(input(apply(trap, control(trap, "trap"), "opponent-left")).carried).toEqual({ trap: { source: "opponent-left", bindingBand: true, move: "firespin" } });
    const wisher = matchup(sv, { "own-right": { species: learner(sv, "wish")! } });
    const wished = apply(wisher, control(wisher, "wish"), "own-right");
    expect(input(wished).carried).toEqual({ wish: Math.floor(getBuildStats(wisher.slots["own-right"].build, sv)!.hp / 2) });
    expect(control(wished, "wish")).toMatchObject({ value: "own-right" });
    const bide = matchup(usum, { "own-left": { species: learner(usum, "bide")!, action: "bide" } });
    const stored = apply(bide, control(bide, "bideStored"), 40);
    expect(input(stored).carried).toEqual({ bide: { stored: 40, source: null, release: false } });
    const released = apply(apply(stored, control(stored, "bideFrom"), "opponent-left"), control(apply(stored, control(stored, "bideFrom"), "opponent-left"), "bideRelease"), true);
    expect(input(released).carried).toEqual({ bide: { stored: 40, source: "opponent-left", release: true } });
    const bond = matchup(sv, { "own-left": { species: holder(sv, "battlebond")!, ability: "battlebond" } });
    expect(input(apply(bond, control(bond, "battleBond"), true)).carried).toEqual({ onceUsed: ["battlebond"] });
  });

  it("writes each side and field control into the turn's field, its turns left and its answers", () => {
    const usum = runtimes[USUM];
    let doubles = matchup(usum, {}, fieldWith(usum, { weather: "Rain", terrain: "Misty", gravity: true, magicRoom: true }));
    doubles = apply(doubles, fieldControl(doubles, "weatherEnds"), true);
    doubles = apply(doubles, fieldControl(doubles, "terrainEnds"), true);
    doubles = apply(doubles, fieldControl(doubles, "gravityEnds"), true);
    doubles = apply(doubles, fieldControl(doubles, "magicRoomEnds"), true);
    doubles = apply(doubles, fieldControl(doubles, "mudSport"), true);
    doubles = apply(doubles, sideControl(doubles, "attackerSide.safeguard"), true);
    doubles = apply(doubles, sideControl(doubles, "defenderSide.luckyChant", "opponent"), true);
    doubles = apply(doubles, sideControl(doubles, "noBench", "opponent"), true);
    const input = getDoublesTurnInput(doubles);
    expect(input).toMatchObject({ weatherTurns: 1, fieldTurns: { terrain: 1, gravity: 1, magicRoom: 1 }, canSwitch: { opponent: false } });
    expect(input.field).toMatchObject({ mudSport: true, attackerSide: { safeguard: true }, defenderSide: { luckyChant: true } });
    const swsh = runtimes[SWSH];
    let gmax = matchup(swsh, {});
    gmax = apply(gmax, sideControl(gmax, "attackerSide.gmaxResidual.gmaxwildfire"), true);
    gmax = apply(gmax, sideControl(gmax, "attackerSide.gmaxResidual.gmaxvinelash"), true);
    // In the table's order.
    expect(getDoublesTurnInput(gmax).field.attackerSide.gmaxResidual).toEqual(["gmaxvinelash", "gmaxwildfire"]);
    const sv = runtimes[SV];
    const rods = matchup(sv, { "own-left": { species: holder(sv, "lightningrod")!, ability: "lightningrod" }, "opponent-right": { species: holder(sv, "lightningrod")!, ability: "lightningrod" } });
    // Entered first: the chosen one rank 0, the other candidates rank 1.
    expect(getDoublesTurnInput(apply(rods, fieldControl(rods, "enteredFirst"), "opponent-right")).entryOrder).toEqual({ "own-left": 1, "opponent-right": 0 });
    const echo = matchup(sv, { "own-left": { species: learner(sv, "echoedvoice")!, action: "echoedvoice" } });
    expect(getDoublesTurnInput(apply(echo, fieldControl(echo, "echoedVoice"), "5")).echoedVoice).toBe(5);
    expect(getDoublesTurnInput(apply(echo, fieldControl(echo, "echoedVoice"), "0")).echoedVoice).toBe(0);
    const copy = matchup(sv, { "own-left": { species: learner(sv, "copycat")!, action: "copycat" } });
    expect(getDoublesTurnInput(apply(copy, fieldControl(copy, "battleLastMove"), "none")).battleLastMove).toBeNull();
    const retaliate = matchup(sv, { "own-right": { species: learner(sv, "retaliate")!, action: "retaliate", target: "opponent-left" } });
    expect(getDoublesTurnInput(apply(retaliate, sideControl(retaliate, "faintedLast"), "no")).faintedLastTurn).toEqual({ own: false });
  });

  it("passes nothing new when nothing is set, and no turn count for an effect that is not up", () => {
    const sv = runtimes[SV];
    const doubles = matchup(sv, {});
    const entry = getDoublesTurnInput(doubles).pokemon["own-left"]!;
    expect(withSlotHistory(entry, NO_HISTORY)).toBe(entry);
    const input = getDoublesTurnInput(doubles);
    expect(withTurnEarlier(input, NO_TURN_EARLIER)).toBe(input);
    expect(withTurnEarlier(input, { gravityEnds: true, weatherEnds: true, terrainEnds: true })).toBe(input);
    // Types given for another species are not passed.
    expect(withSlotHistory(entry, { types: ["Water"], typesOf: "garchomp" })).toBe(entry);
    // Switched in: no action.
    expect(withSlotHistory({ ...entry, action: { moveId: "transform", target: "opponent-left" } }, { switchedIn: true })).toMatchObject({ switchedIn: true, action: { moveId: null, target: null } });
  });
});

describe("2v2 earlier-turn controls: state and reset rules (IN §5.4, ADDENDUM2 §5.2)", () => {
  it("drops the action-bound states the new action does not read, and ends Switched in", () => {
    const sv = runtimes[SV];
    const protect = learner(sv, "protect")!;
    let doubles = withCarried(matchup(sv, { "own-left": { species: protect, action: "protect" } }), "own-left", { stall: 3, charging: "dig", uproar: 1, mustRecharge: true, minimize: true })!;
    doubles = withHistory(doubles, "own-left", { firstTurn: false, lastMove: "protect", switchedIn: true })!;
    const after = afterDoublesAction(doubles, "own-left");
    expect(after.carried["own-left"]).toEqual({ stall: 3, minimize: true });
    expect(after.history["own-left"]).toEqual({ lastMove: "protect" });
    const idle = afterDoublesAction({ ...doubles, actions: { ...doubles.actions, "own-left": { moveId: null, target: null } } }, "own-left");
    expect(idle.carried["own-left"]).toEqual({ mustRecharge: true, minimize: true });
    expect(afterDoublesAction(matchup(sv, {}), "own-left")).toEqual(matchup(sv, {}));
  });

  it("Switched in: No move, no action-bound state, Recharging included; counted among the toggles", () => {
    const sv = runtimes[SV];
    let state: CalculatorState = { matchup: createMatchup(0), doubles: withCarried(matchup(sv, { "own-left": { species: learner(sv, "protect")!, action: "protect" } }), "own-left", { stall: 9, mustRecharge: true })! };
    const key = state.doubles.slots["own-left"].key;
    state = setDoublesSwitchedIn(state, key, true);
    expect(state.doubles.actions["own-left"]).toEqual({ moveId: null, target: null });
    expect(state.doubles.carried["own-left"]).toEqual({});
    expect(state.doubles.history["own-left"]).toEqual({ switchedIn: true });
    expect(getDoublesTurnInput(state.doubles).pokemon["own-left"]).toMatchObject({ switchedIn: true });
    expect(earlierTurnToggles(state.doubles)).toBe(1);
    // No Recharging control for a Pokémon that switched in.
    expect(control(state.doubles, "recharge")).toBeUndefined();
    expect(switchDoublesIn(state.doubles, "own-left", false).history["own-left"]).toBe(NO_HISTORY);
    expect(setDoublesSwitchedIn(state, -1, true)).toBe(state);
  });

  it("clears a slot that gets another Pokémon, the entry order with it, and the states that name it as their source", () => {
    const sv = runtimes[SV];
    let doubles = matchup(sv, {});
    doubles = withCarried(doubles, "own-left", { minimize: true })!;
    doubles = withHistory(doubles, "own-left", { lastMove: "transform" })!;
    doubles = withCarried(doubles, "opponent-left", { attract: "own-left", leechSeed: "own-left", trap: { source: "own-left", bindingBand: false }, futureMove: { move: "futuresight", source: "own-left" }, minimize: true })!;
    doubles = withHistory(doubles, "own-right", { wishFrom: "own-left" })!;
    doubles = withTurnEarlierState(doubles, { entered: { "own-left": 1, "opponent-left": 0, "opponent-right": 1 } });
    const cleared = clearSlotEarlier(doubles, "own-left");
    expect(cleared.carried["own-left"]).toEqual({});
    expect(cleared.history["own-left"]).toBe(NO_HISTORY);
    // Leech Seed's source is a position (the Pokémon standing there heals): it stays.
    expect(cleared.carried["opponent-left"]).toEqual({ leechSeed: "own-left", minimize: true });
    expect(cleared.history["own-right"]).toBe(NO_HISTORY);
    expect(cleared.turnEarlier.entered).toEqual({ "opponent-left": 0, "opponent-right": 1 });
    // The one entered first gone: no order is left.
    expect(clearSlotEarlier(cleared, "opponent-left").turnEarlier).toBe(NO_TURN_EARLIER);
    expect(clearSlotEarlier(matchup(sv, {}), "own-left")).toEqual(matchup(sv, {}));
  });

  it("drops types given for another species, an added type under Tera, and follows a trap's Binding Band and a Wish's HP", () => {
    const sv = runtimes[SV];
    let doubles = withHistory(matchup(sv, {}), "own-left", { types: ["Water"], addedType: "Grass", typesOf: "ditto" })!;
    expect(reconcileEarlier(doubles)).toBe(doubles);
    const mega = { ...doubles, slots: { ...doubles.slots, "own-left": { ...doubles.slots["own-left"], build: { ...doubles.slots["own-left"].build, speciesId: "snorlax" } } } };
    expect(reconcileEarlier(mega).history["own-left"]).toBe(NO_HISTORY);
    const tera = { ...doubles, slots: { ...doubles.slots, "own-left": { ...doubles.slots["own-left"], build: { ...doubles.slots["own-left"].build, mechanic: "tera" as const, configuration: { teraType: "Stellar" } } } } };
    expect(reconcileEarlier(tera).history["own-left"]).toEqual({ types: ["Water"], typesOf: "ditto" });
    const trapper = learner(sv, "firespin")!;
    doubles = withCarried(matchup(sv, { "opponent-left": { species: trapper, quick: ["firespin"] } }), "own-left", { trap: { source: "opponent-left", bindingBand: false, move: "firespin" } })!;
    const banded = { ...doubles, slots: { ...doubles.slots, "opponent-left": { ...doubles.slots["opponent-left"], build: { ...doubles.slots["opponent-left"].build, itemId: "bindingband" } } } };
    expect(reconcileEarlier(banded).carried["own-left"].trap).toEqual({ source: "opponent-left", bindingBand: true, move: "firespin" });
    const wisher = learner(sv, "wish")!;
    doubles = matchup(sv, { "own-right": { species: wisher } });
    doubles = apply(doubles, control(doubles, "wish"), "own-right");
    const stronger = { ...doubles, slots: { ...doubles.slots, "own-right": { ...doubles.slots["own-right"], build: { ...doubles.slots["own-right"].build, nature: "Serious", native: { ...(doubles.slots["own-right"].build as { native: { evs: Record<string, number> } }).native, evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } } } as BattleBuild } } };
    const hp = Math.floor(getBuildStats(stronger.slots["own-right"].build, sv)!.hp / 2);
    expect(reconcileEarlier(stronger).carried["own-left"].wish).toBe(hp);
  });

  it("bounds the carried fields to the build and the game (reconcileCarried)", () => {
    const sv = runtimes[SV], usum = runtimes[USUM], swsh = runtimes[SWSH];
    const ditto = createBuild("ditto", sv);
    expect(reconcileCarried({ nightmare: true, berryLocked: true, cudChew: "sitrusberry", laserFocus: true }, ditto, sv)).toEqual({});
    expect(reconcileCarried({ nightmare: true }, { ...ditto, status: "slp" }, sv)).toEqual({ nightmare: true });
    expect(reconcileCarried({ healBlock: 4, embargo: 2 }, ditto, sv)).toEqual({ healBlock: 1 });
    expect(reconcileCarried({ healBlock: 4, embargo: 2, telekinesis: 2, laserFocus: true }, createBuild("ditto", usum), usum)).toEqual({ healBlock: 4, embargo: 2, telekinesis: 2, laserFocus: true });
    expect(reconcileCarried({ healBlock: 1 }, createBuild("ditto", swsh), swsh)).toEqual({});
    expect(reconcileCarried({ stockpile: { layers: 5 as 3, def: -4 }, stages: { accuracy: 9, evasion: 0 } }, ditto, sv)).toEqual({ stockpile: { layers: 3, def: -3 }, stages: { accuracy: 6 } });
    const same = { stockpile: { layers: 2 as const }, stages: { evasion: -2 } };
    expect(reconcileCarried(same, ditto, sv)).toBe(same);
  });

  it("drops an ending answer when its effect is turned off", () => {
    const sv = runtimes[SV];
    const doubles = withTurnEarlierState(matchup(sv, {}, fieldWith(sv, { weather: "Rain", terrain: "Misty", gravity: true })), { weatherEnds: true, terrainEnds: true, gravityEnds: true, battleLastMove: null });
    expect(afterDoublesField(doubles)).toBe(doubles);
    const strong = { ...doubles, field: { ...doubles.field, weather: "Heavy Rain" as const, terrain: "" as const, gravity: false } };
    expect(afterDoublesField(strong).turnEarlier).toEqual({ battleLastMove: null });
  });

  it("makes Foresight and Miracle Eye exclusive, and Battle Bond add and remove only itself", () => {
    const usum = runtimes[USUM];
    const sableye = supported(usum).find((entry) => entry.types.includes("Ghost") && entry.types.includes("Dark"));
    if (sableye) {
      let doubles = matchup(usum, { "own-left": { species: sableye.id }, "opponent-left": { species: learner(usum, "foresight", (entry) => entry.moves.includes("miracleeye")) ?? learner(usum, "foresight")! }, "opponent-right": { species: learner(usum, "miracleeye")! } });
      doubles = apply(doubles, control(doubles, "foresight"), true);
      doubles = apply(doubles, control(doubles, "miracleEye"), true);
      expect(doubles.carried["own-left"]).toEqual({ miracleEye: true });
    }
    const sv = runtimes[SV];
    let bond = withCarried(matchup(sv, { "own-left": { species: holder(sv, "battlebond")!, ability: "battlebond" } }), "own-left", { onceUsed: ["intrepidsword"] })!;
    bond = apply(bond, control(bond, "battleBond"), true);
    expect(bond.carried["own-left"].onceUsed).toEqual(["intrepidsword", "battlebond"]);
    expect(apply(bond, control(bond, "battleBond"), false).carried["own-left"].onceUsed).toEqual(["intrepidsword"]);
  });

  it("applies a change to the calculator state, the same state when nothing changes", () => {
    const state: CalculatorState = { matchup: createMatchup(0), doubles: matchup(runtimes[SV], {}) };
    expect(applyDoublesEarlier(state, (doubles) => doubles)).toBe(state);
    const next = applyDoublesEarlier(state, sideControl(state.doubles, "noBench")!.kind === "check" ? (sideControl(state.doubles, "noBench") as Extract<EarlierControl, { kind: "check" }>).set(true) : (d) => d);
    expect(next.doubles.turnEarlier).toEqual({ noneLeft: { own: true } });
  });
});

describe("2v2 earlier-turn controls: the summary's toggles (ADDENDUM2 §5.2, IN §5.5)", () => {
  it("counts the conditions set, never the history answers", () => {
    const sv = runtimes[SV];
    let doubles = matchup(sv, {
      "own-left": { species: learner(sv, "protect")!, action: "protect" },
      "opponent-left": { species: learner(sv, "encore")!, action: "encore", target: "own-left" },
    }, fieldWith(sv, { weather: "Rain" }));
    expect(earlierTurnToggles(doubles)).toBe(0);
    // History answers: none counts.
    doubles = apply(doubles, control(doubles, "stall"), "2");
    doubles = apply(doubles, control(doubles, "lastMove"), "none");
    doubles = apply(doubles, fieldControl(doubles, "weatherEnds"), true);
    expect(earlierTurnToggles(doubles)).toBe(0);
    // Conditions: each counts once.
    doubles = withCarried(doubles, "own-right", { minimize: true, perish: 2, stages: { accuracy: 1, evasion: -1 } })!;
    doubles = apply(doubles, sideControl(doubles, "attackerSide.safeguard"), true);
    doubles = apply(doubles, sideControl(doubles, "noBench", "opponent"), true);
    expect(earlierTurnToggles(doubles)).toBe(6);
  });
});

/** The four groups' today's controls, as useDoublesView builds them (doubles-prep carriedOptions). */
function carriedControls(doubles: DoublesMatchup): CarriedControl[] {
  return DOUBLES_SLOTS.map((slot) => ({
    slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: namesOf(doubles)[slot], value: doubles.carried[slot],
    options: doubles.slots[slot].build.currentHP === 0 ? NO_CARRIED_OPTIONS : carriedOptions(doubles.slots[slot].build, doubles.runtime, !!doubles.carried[slot].sleep?.rest, carriedAbilityOn(doubles, slot)),
    onChange: () => undefined,
  }));
}

/** Field conditions' earlier-turn parts as BattleConditions places them, for `doubles` (with EarlierTurnContext). */
function page(doubles: DoublesMatchup, onChange: (change: EarlierChange) => void = () => undefined) {
  const carried = carriedControls(doubles);
  return renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles, issues: null, apply: onChange } },
    createElement(Fragment, null,
      createElement(EarlierFieldFields, { id: "f-weather", part: "weather" }),
      createElement(EarlierFieldFields, { id: "f-shared", part: "shared" }),
      ...(["attackerSide", "defenderSide"] as const).map((side) => createElement("fieldset", { key: side }, createElement(EarlierTurnFields, { id: "f-carried", side, carried, charge: [] }))))));
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("2v2 earlier-turn controls: accessible names, phone width, today's markup", () => {
  it("gives every control a unique accessible name and a label for its id", () => {
    for (const game of GAMES) {
      const html = page(busy(runtimes[game]));
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(ids).size, game).toBe(ids.length);
      for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
      for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) for (const id of references.split(" ")) expect(ids).toContain(id);
      const names = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((match) => text(match[1]).trim());
      expect(names.length).toBeGreaterThan(10);
      expect(new Set(names).size, `${game}: ${names.filter((name, index) => names.indexOf(name) !== index).join(" | ")}`).toBe(names.length);
      expect(text(html)).not.toMatch(/\b(own|opponent)-(left|right)\b/);
    }
  });

  it("wraps every label in its column and keeps the selects in the compact fields grid at 375 px", () => {
    const html = page(busy(runtimes[SV]));
    const swalot = html.slice(html.indexOf('data-doubles-carried="own-left"'));
    // Swalot's group with every control it can show, set: the busiest group.
    expect((swalot.match(/<select/g) ?? []).length).toBeGreaterThan(3);
    for (const [tag] of html.matchAll(/<label[^>]*class="[^"]*"[^>]*>/g)) {
      if (/flex/.test(tag)) expect(tag).toMatch(/min-w-0/);
    }
    for (const [tag] of html.matchAll(/<label[^>]*class="flex[^"]*"[^>]*>/g)) expect(tag).toMatch(/wrap-anywhere|flex min-h-11 items-center/);
    // Each select sits in a grid of styles.fields (auto-fill columns of at least min(100%, 9rem)).
    const grids = [...html.matchAll(new RegExp(`<div class="${styles.fields}[^"]*">([\\s\\S]*?)(?=<div class="${styles.fields}|<div role="group"|</fieldset>|$)`, "g"))].map((match) => match[1]);
    const inGrids = grids.reduce((sum, grid) => sum + (grid.match(/<select/g) ?? []).length, 0);
    expect(inGrids).toBe((html.match(/<select/g) ?? []).length);
    // No fixed widths.
    expect(html).not.toMatch(/\b(w|min-w)-\[\d|style="[^"]*width/);
  });

  it("renders a Pokémon whose turn reads nothing new exactly as today", () => {
    const sv = runtimes[SV];
    const doubles = matchup(sv, {});
    const [ditto] = carriedControls(doubles);
    const today = renderToStaticMarkup(createElement(CarriedFields, { id: "g", control: ditto }));
    expect(renderToStaticMarkup(createElement(CarriedFields, { id: "g", control: ditto, earlier: earlierSlotControls(doubles, "own-left"), onEarlier: () => undefined }))).toBe(today);
    expect(earlierSlotControls(doubles, "own-left")).toEqual([]);
    // Without the context: only today's controls.
    const html = renderToStaticMarkup(createElement(EarlierTurnFields, { id: "f", side: "attackerSide", carried: carriedControls(doubles), charge: [] }));
    expect(html).not.toMatch(/data-doubles-(no-bench|side-safeguard)/);
    expect(renderToStaticMarkup(createElement(EarlierFieldFields, { id: "x", part: "shared" }))).toBe("");
  });

  it("reads each side's controls with its side, and calls the change of the control used", () => {
    const sv = runtimes[SV];
    const changes: EarlierChange[] = [];
    const html = page(matchup(sv, {}), (change) => changes.push(change));
    expect(text(html)).toContain("Safeguard: your side");
    expect(text(html)).toContain("Safeguard: the opponent's side");
    expect(text(html)).toContain("No Pokémon left to switch in: the opponent's side");
    expect(html).toMatch(/data-doubles-no-bench="opponent"/);
    expect(changes).toEqual([]);
  });

  it("shows the turn's input issue at its control", () => {
    const sv = runtimes[SV];
    const issues = [{ field: "carried.stall", message: "The protecting moves' counter is 1, 3, 9, 27, 81, 243 or 729." }, { field: "nature", message: "x" }];
    expect(earlierIssueTexts(issues, "Garchomp")).toEqual({ stall: "Garchomp: The protecting moves' counter is 1, 3, 9, 27, 81, 243 or 729." });
    const doubles = withCarried(matchup(sv, { "own-left": { species: learner(sv, "protect")!, action: "protect" } }), "own-left", { stall: 9 })!;
    const html = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles, issues: { pokemon: { "own-left": issues }, field: [], actions: [] }, apply: () => undefined } },
      createElement(EarlierTurnFields, { id: "f", side: "attackerSide", carried: carriedControls(doubles), charge: [] })));
    expect(html).toMatch(/<select[^>]*aria-describedby="f-own-left-stall-error"[^>]*aria-invalid="true"[^>]*data-doubles-stall="own-left"/);
    expect(text(html)).toContain(`${namesOf(doubles)["own-left"]}: The protecting moves' counter is 1, 3, 9, 27, 81, 243 or 729.`);
  });
});

describe("2v2 earlier-turn controls: tables and engine agree", () => {
  it("keeps its move tables equal to the engine's", () => {
    expect([...EARLIER_TABLES.twoTurn].sort()).toEqual([...CHARGE_TURN_MOVES, ...SEMI_INVULNERABLE_MOVES, "geomancy"].sort());
    expect([...EARLIER_TABLES.protecting].sort()).toEqual([...Object.keys(PROTECT_MOVES), "endure"].sort());
    expect([...EARLIER_TABLES.healingBerries].sort()).toEqual([...HEALING_BERRIES].sort());
  });

  it("writes only values the turn's validation accepts, in every game", async () => {
    const { calculateDoublesTurn } = await import("@/app/lib/battle/doubles-turn");
    for (const game of GAMES) {
      const runtime = runtimes[game];
      for (const entry of CASES) {
        const doubles = entry.shown(runtime);
        if (!doubles || !entry.games.includes(game)) continue;
        const found = lookup(entry, doubles)!;
        const values = found.kind === "check" ? [true] : found.kind === "number" ? [12] : found.choices.map((choice) => choice.value).filter((value) => value !== found.value).slice(0, 3);
        for (const value of values) {
          const next = apply(doubles, found, value);
          const result = calculateDoublesTurn(getDoublesTurnInput(next));
          if (result.status !== "issues") continue;
          const own = [...Object.values(result.issues.pokemon).flat().map((issue) => `${issue.field}: ${issue.message}`), ...result.issues.field.map((issue) => `${issue.field}: ${issue.message}`)];
          // The matchup's own setup (Ditto's Transform, a chosen move's target) aside, nothing the control wrote is an issue.
          expect(own, `${game} ${entry.key} = ${String(value)}`).toEqual([]);
        }
      }
    }
  }, 60_000);
});

describe("The 2v2 note: Battle states that cannot be set here (IN §5.6)", () => {
  it("drops what 2v2 sets or works out and lists what it cannot set, per game", () => {
    for (const game of GAMES) {
      const states = unmodelledDoublesStates(runtimes[game]);
      expect(states.join(" ")).not.toMatch(/Wide Guard|Max Guard|partner's|Ruin|Foresight|Glaive Rush|in the middle of|Minimize|Substitute|Grounding|swapped or shared|The order|G-Max/);
      expect(states).toContain("Torment or Throat Chop from an earlier turn");
      expect(states.some((state) => state.startsWith("A move locked in by Outrage, Petal Dance"))).toBe(true);
      expect(states.some((state) => /^An ability suppressed by Gastro Acid/.test(state) && state.endsWith("on an earlier turn"))).toBe(true);
      expect(states.some((state) => /Uproar/.test(state))).toBe(false);
      expect(unmodelledBattleStates(runtimes[game]).length).toBeGreaterThan(states.length - 1);
    }
    expect(unmodelledDoublesStates(runtimes[USUM])).toContain("A Sky Drop from an earlier turn");
    expect(unmodelledDoublesStates(runtimes[SV])).not.toContain("A Sky Drop from an earlier turn");
    expect(unmodelledDoublesStates(runtimes[CH])).toContain("A Healing Wish waiting for the next Pokémon to come in");
    expect(unmodelledDoublesStates(championsRuntime)).toBe(unmodelledDoublesStates(championsRuntime));
  });
});
