import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { combatant, EMPTY_PANEL } from "../fixtures/doubles-turn";
import { positionalIn } from "../fixtures/naming";
import BenchFields from "@/app/(app)/calculator/BenchFields";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import DoublesTurn from "@/app/(app)/calculator/DoublesTurn";
import EarlierTurnFields, { EarlierTurnContext, type CarriedControl, type EarlierTurnState } from "@/app/(app)/calculator/EarlierTurnFields";
import type { DoublesCardView } from "@/app/(app)/calculator/DoublesCard";
import styles from "@/app/(app)/calculator/calculator.module.css";
import {
  addBenchEntry, asksSwitchIn, benchBuild, benchNamesOf, benchSideView, clearSlotEarlier, EARLIER_TABLES, earlierSideControls, earlierSlotControls, earlierTurnToggles,
  hazardControls, NO_BENCH, NO_CARRIED_OPTIONS, removeBenchEntry, setBenchEntry, setBenchHazards, setBenchPick, switchInOf, switchInOptions, withBench,
  type DoublesBenchEntry, type EarlierChange, type EarlierControl,
} from "@/app/(app)/calculator/doubles-inputs";
import { actionTargets, idName, leaverText, namesFor, recordOf, residualLine, slotSwitches, stepHeading, stepNames, turnSummary } from "@/app/(app)/calculator/doubles-format";
import {
  addChosenDoublesBench, addDoublesBench, chooseDoublesMove, chooseDoublesSwitchIn, createDoubles, followShared, getDoublesTurnInput, resetDoubles, selectDoublesRoster, type CalculatorState, type DoublesMatchup,
} from "@/app/(app)/calculator/doubles-prep";
import type { CalculatorRosterState } from "@/app/(app)/calculator/roster-data";
import {
  changeBattleGame, createMatchup, getMoveOwner, getTeamPanel, reconcileRosters, selectRosterPokemon, updateMatchupBuild,
  type PreparedMatchup, type RosterChoice, type RosterRole, type RosterSource,
} from "@/app/(app)/calculator/roster-prep";
import type { TeamRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import { DRAG_MOVES, SWITCH_MOVES } from "@/app/lib/battle/doubles-actions";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import {
  DOUBLES_SLOTS, doublesNames, slotSide, startId, turnBenchNames,
  type DoublesHP, type DoublesSideId, type DoublesSlotId, type DoublesStep, type DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, getBuildStats, STATUSES } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility, type MoveSlots } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, ChampionsSpecies, MoveDamageResult } from "@/app/lib/battle/types";

// status2 Track R-U (IN §5.7, ADDENDUM2 §5.3; SPEC2 §5.2's R part): the 2v2 calculator's Bench, Replacement and Hazards, the
// Bench over Lands this turn, their mapping into the turn's input and the engine's validation, the state rules, the rendered
// controls (names, never positions; unique accessible names; the phone-width grids), and the switches on the cards and in
// the turn panel.

const GAMES: readonly BattleGame[] = ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"];
const SV = "scarlet_violet", CH = "champions", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon";
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of GAMES) runtimes[game] = await loadBattleRuntime(game);
});

type Mon = {
  species: string; ability?: string; item?: string; status?: BattleBuild["status"]; action?: string | null; target?: DoublesSlotId | null; mechanic?: BattleBuild["mechanic"]; useZ?: boolean;
  /** Its prepared moves (Sleep Talk's pool). */
  moves?: string[];
};

/** A 2v2 matchup: Ditto (Limber) in every slot `mons` leaves out, each Pokémon with its action. */
function matchup(runtime: BattleRuntime, mons: Partial<Record<DoublesSlotId, Mon>> = {}): DoublesMatchup {
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots };
  const actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const mon = mons[slot] ?? { species: "ditto", ability: "limber" };
    const fresh = createBuild(mon.species, runtime);
    const build = {
      ...fresh, ...(mon.ability ? { abilityId: mon.ability } : {}), ...(mon.item !== undefined ? { itemId: mon.item } : {}),
      ...(mon.status ? { status: mon.status } : {}), ...(mon.mechanic ? { mechanic: mon.mechanic } : {}),
    } as BattleBuild;
    const moves = [0, 1, 2, 3].map((index) => ({ moveId: mon.moves?.[index] ?? null, origin: "manual", gameType: "Doubles" })) as MoveSlots;
    slots[slot] = { ...slots[slot], build, moves, contexts: mon.useZ && mon.action ? { [mon.action]: { useZ: true } } : {} };
    actions[slot] = { moveId: mon.action ?? null, target: mon.target ?? null };
  }
  return { ...base, slots, actions };
}

const supported = (runtime: BattleRuntime) => runtime.catalog.species.filter((entry) => !entry.battleForm && !entry.unsupported.length);
/** A species of the game that learns `moveId` (and passes `test`); null when none does. */
function learner(runtime: BattleRuntime, moveId: string, test: (species: ChampionsSpecies) => boolean = () => true): string | null {
  if (!runtime.movesById.has(moveId)) return null;
  return supported(runtime).find((entry) => entry.moves.includes(moveId) && test(entry))?.id ?? null;
}
function holder(runtime: BattleRuntime, abilityId: string): string | null {
  return supported(runtime).find((entry) => entry.abilities.includes(abilityId))?.id ?? null;
}
const speciesName = (runtime: BattleRuntime, id: string) => runtime.speciesById.get(id)!.name;

/** A roster source of `side` (a paste entry), and its roster choice and bench entry. */
function sourceOf(runtime: BattleRuntime, side: DoublesSideId, index: number, species: string): RosterSource {
  return { kind: "paste", key: `test:${side}:${index}`, name: speciesName(runtime, species), speciesId: species, runtimeIdentity: runtime.identity, role: side, importId: "test", index };
}
const choiceOf = (source: RosterSource): RosterChoice => ({ key: source.key, name: source.name, speciesId: source.speciesId, source, reason: null });
function entryOf(runtime: BattleRuntime, side: DoublesSideId, index: number, species: string, build: Partial<BattleBuild> = {}, moves: string[] = []): DoublesBenchEntry {
  const source = sourceOf(runtime, side, index, species);
  return { key: source.key, source, base: { ...createBuild(species, runtime), ...build } as BattleBuild, moves };
}
/** `doubles` with `entries` on `side`'s bench. */
const benched = (doubles: DoublesMatchup, side: DoublesSideId, ...entries: DoublesBenchEntry[]) => entries.reduce((current, entry) => addBenchEntry(side, entry, [])(current), doubles);

function apply(doubles: DoublesMatchup, control: EarlierControl | undefined, value: boolean | string | number | null): DoublesMatchup {
  if (!control) throw new Error("no such control");
  const change: EarlierChange = control.kind === "check" ? control.set(value as boolean) : control.kind === "select" ? control.set(value as string) : control.set(value as number | null);
  return change(doubles);
}
const slotControl = (doubles: DoublesMatchup, key: string, slot: DoublesSlotId = "own-left") => earlierSlotControls(doubles, slot).find((entry) => entry.key === key);
const hazard = (doubles: DoublesMatchup, flag: string, side: DoublesSideId = "own") => hazardControls(doubles, side).find((entry) => entry.key === `hazard.${flag}`);
const rowControl = (doubles: DoublesMatchup, key: string, index = 0, side: DoublesSideId = "own") => benchSideView(doubles, side).rows[index]?.controls.find((entry) => entry.key === `bench-${index}.${key}`);

/** A switcher in own-left: a U-turn user aiming at a foe. */
function uturner(runtime: BattleRuntime): Mon {
  return { species: learner(runtime, "uturn")!, action: "uturn", target: "opponent-left" };
}

describe("the Bench: when it shows (IN §5.7)", () => {
  it("shows a side's Bench when its roster has a Pokémon beyond the two in play and one of its Pokémon can come in, or while set", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const roster = [choiceOf(sourceOf(runtime, "own", 0, "snorlax"))];
      const doubles = matchup(runtime, { "own-left": uturner(runtime) });
      expect(benchSideView(doubles, "own", roster).shown, game).toBe(true);
      expect(benchSideView(doubles, "own", roster)).toMatchObject({ add: [{ value: roster[0].source!.key, label: "Snorlax" }], choose: false });
      // No roster at all (no team chosen or imported): any Pokémon of the game can be added (the Pokémon search).
      expect(benchSideView(doubles, "own", [])).toMatchObject({ shown: true, add: [], choose: true });
      expect(benchSideView(doubles, "opponent", [])).toMatchObject({ shown: false, choose: true });
      // A choice with no source (a duplicate roster name) is not offered.
      expect(benchSideView(doubles, "own", [{ ...roster[0], source: null }]).shown).toBe(false);
      // No Pokémon of the other side can come in: a foe's U-turn is not its own.
      expect(benchSideView(doubles, "opponent", [choiceOf(sourceOf(runtime, "opponent", 0, "snorlax"))]).shown).toBe(false);
      // No reader: hidden; set: shown.
      const idle = matchup(runtime);
      expect(benchSideView(idle, "own", roster).shown).toBe(false);
      expect(benchSideView(benched(idle, "own", entryOf(runtime, "own", 0, "snorlax")), "own").shown).toBe(true);
      // A roster entry in play on its side is not offered: no Pokémon beyond the two in play.
      const playing = { ...doubles, slots: { ...doubles.slots, "own-right": { ...doubles.slots["own-right"], source: roster[0].source } } };
      expect(benchSideView(playing, "own", roster)).toMatchObject({ shown: false, choose: false });
    }
  });

  it("reads every way a Pokémon of the side can come in this turn", () => {
    const cases: { game: BattleGame; what: string; mons: Partial<Record<DoublesSlotId, Mon | null>>; side: DoublesSideId; shown: boolean }[] = [];
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const by = (moveId: string, slot: DoublesSlotId = "own-left", target: DoublesSlotId | null = "opponent-left") => {
        const species = learner(runtime, moveId);
        return species ? { [slot]: { species, action: moveId, target } } : null;
      };
      for (const moveId of EARLIER_TABLES.chosenSwitch) {
        const mons = by(moveId);
        if (mons) cases.push({ game, what: moveId, mons, side: "own", shown: !(moveId === "teleport" && game === USUM) });
      }
      for (const item of EARLIER_TABLES.switchItems) if (runtime.itemsById.has(item)) cases.push({ game, what: item, mons: { "own-left": { species: "snorlax", item } }, side: "own", shown: true });
      for (const ability of EARLIER_TABLES.switchAbilities) {
        const species = holder(runtime, ability);
        if (species) cases.push({ game, what: ability, mons: { "own-left": { species, ability } }, side: "own", shown: true });
      }
      for (const moveId of EARLIER_TABLES.drag) {
        const mons = by(moveId, "opponent-left", "own-right");
        if (mons) {
          cases.push({ game, what: `${moveId} into your side`, mons, side: "own", shown: true });
          cases.push({ game, what: `${moveId} not into the opponent's own side`, mons, side: "opponent", shown: false });
        }
      }
      cases.push({ game, what: "a foe's Red Card", mons: { "opponent-right": { species: "snorlax", item: "redcard" } }, side: "own", shown: true });
      cases.push({ game, what: "its own Red Card", mons: { "opponent-right": { species: "snorlax", item: "redcard" } }, side: "opponent", shown: false });
      for (const moveId of EARLIER_TABLES.benchReaders) {
        const mons = by(moveId, "own-right", null);
        if (mons) cases.push({ game, what: moveId, mons, side: "own", shown: true });
      }
    }
    expect(cases.length).toBeGreaterThan(60);
    for (const { game, what, mons, side, shown } of cases) {
      const runtime = runtimes[game];
      const doubles = matchup(runtime, mons as Partial<Record<DoublesSlotId, Mon>>);
      expect(benchSideView(doubles, side, [choiceOf(sourceOf(runtime, side, 0, "snorlax"))]).shown, `${game} ${what}`).toBe(shown);
    }
  });

  it("reads a Roar sent back by Magic Bounce or Magic Coat, an ally's Red Card against a spread move, and a calling move's switch", () => {
    const shown = (runtime: BattleRuntime, mons: Partial<Record<DoublesSlotId, Mon>>, side: DoublesSideId) => benchSideView(matchup(runtime, mons), side, [choiceOf(sourceOf(runtime, side, 0, "snorlax"))]).shown;
    let checked = 0;
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const roar = learner(runtime, "roar"), bouncer = holder(runtime, "magicbounce"), coat = learner(runtime, "magiccoat"), quake = learner(runtime, "earthquake");
      const talker = learner(runtime, "sleeptalk", (entry) => entry.moves.includes("uturn")), copier = learner(runtime, "copycat"), uturn = learner(runtime, "uturn");
      if (roar && bouncer) {
        const mons = { "own-left": { species: roar, action: "roar", target: "opponent-left" as DoublesSlotId }, "opponent-left": { species: bouncer, ability: "magicbounce" } };
        expect(shown(runtime, mons, "own"), `${game} Roar into Magic Bounce`).toBe(true);
        expect(shown(runtime, { "own-left": mons["own-left"] }, "own"), `${game} Roar, no bounce`).toBe(false);
        checked++;
      }
      if (roar && coat) {
        expect(shown(runtime, { "own-left": { species: roar, action: "roar", target: "opponent-left" }, "opponent-left": { species: coat, action: "magiccoat", target: null } }, "own"), `${game} Roar into Magic Coat`).toBe(true);
        checked++;
      }
      if (quake) {
        expect(shown(runtime, { "own-left": { species: quake, action: "earthquake", target: null }, "own-right": { species: "snorlax", item: "redcard" } }, "own"), `${game} an ally's Red Card`).toBe(true);
        expect(shown(runtime, { "own-left": { species: quake, action: "earthquake", target: null }, "opponent-right": { species: "snorlax", item: "redcard" } }, "opponent"), `${game} its own Red Card, no ally hit`).toBe(false);
        checked++;
      }
      if (talker) {
        expect(shown(runtime, { "own-left": { species: talker, action: "sleeptalk", target: null, status: "slp", moves: ["sleeptalk", "uturn"] } }, "own"), `${game} Sleep Talk with U-turn`).toBe(true);
        expect(shown(runtime, { "own-left": { species: talker, action: "sleeptalk", target: null, status: "slp", moves: ["sleeptalk"] } }, "own"), `${game} Sleep Talk alone`).toBe(false);
        checked++;
      }
      if (copier && uturn) {
        expect(shown(runtime, { "own-left": { species: copier, action: "copycat", target: null }, "opponent-left": { species: uturn, action: "uturn", target: "own-left" } }, "own"), `${game} Copycat after a U-turn`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("reads an instructed U-turn (its Last move) and, in Ultra Sun/Ultra Moon, a Me First of a foe's U-turn, with their Replacement (review 2 R6-7)", () => {
    // Pinned instruct re-runs the target's lastMove as a new action; mefirst uses the target's queued move; U-turn's selfSwitch follows.
    const sv = runtimes[SV];
    const instructed = (last: string | null) => {
      const doubles = matchup(sv, {
        "own-left": { species: learner(sv, "instruct")!, action: "instruct", target: "own-right" },
        "own-right": { species: "ambipom", ability: "technician", action: "doublehit", target: "opponent-left", moves: ["uturn", "doublehit"] },
        "opponent-left": { species: "snorlax", ability: "thickfat", action: "bodyslam", target: "own-right" },
      });
      return last ? { ...doubles, history: { ...doubles.history, "own-right": { lastMove: last, lastMoveTarget: "opponent-left" as DoublesSlotId } } } : doubles;
    };
    const roster = [choiceOf(sourceOf(sv, "own", 0, "corviknight"))];
    expect(benchSideView(instructed("uturn"), "own", roster).shown).toBe(true);
    expect(benchSideView(instructed("doublehit"), "own", roster).shown).toBe(false);
    // With the Bench set, the Replacement and an estimated turn (the verifier's V-INSU-BENCH: Corviknight comes in).
    let doubles = { ...benched(instructed("uturn"), "own", entryOf(sv, "own", 0, "corviknight")), field: { ...instructed("uturn").field, trickRoom: true } };
    expect(slotControl(doubles, "replacement", "own-right")).toBeDefined();
    doubles = setBenchPick("own-right", "test:own:0")(doubles);
    const result = calculateDoublesTurn(getDoublesTurnInput(doubles));
    expect(result.status === "ready" && result.replaced?.["own-right"]?.entered).toEqual([{ id: "test:own:0", chance: 1 }]);
    const usum = runtimes[USUM];
    const mefirst = (target: DoublesSlotId | null) => matchup(usum, {
      "own-left": { species: "absol", ability: "pressure", action: "mefirst", target },
      "opponent-left": { species: learner(usum, "uturn")!, action: "uturn", target: "own-right" },
    });
    const usumRoster = [choiceOf(sourceOf(usum, "own", 0, "snorlax"))];
    expect(benchSideView(mefirst("opponent-left"), "own", usumRoster).shown).toBe(true);
    expect(benchSideView(mefirst(null), "own", usumRoster).shown).toBe(true);
    expect(benchSideView(mefirst("opponent-right"), "own", usumRoster).shown).toBe(false);
  });

  it("does not read a switching move used as a Max Move, or a damaging one as a Z-Move", () => {
    const swsh = runtimes[SWSH], usum = runtimes[USUM];
    const roster = (runtime: BattleRuntime) => [choiceOf(sourceOf(runtime, "own", 0, "snorlax"))];
    expect(benchSideView(matchup(swsh, { "own-left": { ...uturner(swsh), mechanic: "dynamax" } }), "own", roster(swsh)).shown).toBe(false);
    expect(benchSideView(matchup(usum, { "own-left": { ...uturner(usum), useZ: true } }), "own", roster(usum)).shown).toBe(false);
    // A Z status move keeps its effect: Z-Parting Shot still switches out.
    const parting = learner(usum, "partingshot")!;
    expect(benchSideView(matchup(usum, { "own-left": { species: parting, action: "partingshot", target: "opponent-left", useZ: true } }), "own", roster(usum)).shown).toBe(true);
  });

  it("keeps its tables equal to the engine's switching and dragging moves", () => {
    expect([...EARLIER_TABLES.chosenSwitch].sort()).toEqual([...SWITCH_MOVES].sort());
    expect([...EARLIER_TABLES.drag].sort()).toEqual([...DRAG_MOVES, "roar", "whirlwind"].sort());
  });

  it("replaces No Pokémon left to switch in once the side's bench holds a Pokémon, and a Pokémon on the bench ends it", () => {
    const sv = runtimes[SV];
    let doubles = matchup(sv, { "own-left": uturner(sv) });
    doubles = apply(doubles, earlierSideControls(doubles, "own").find((entry) => entry.key === "noBench"), true);
    expect(doubles.turnEarlier.noneLeft).toEqual({ own: true });
    expect(getDoublesTurnInput(doubles).canSwitch).toEqual({ own: false });
    doubles = benched(doubles, "own", entryOf(sv, "own", 0, "snorlax"));
    expect(doubles.turnEarlier.noneLeft).toBeUndefined();
    expect(earlierSideControls(doubles, "own").some((entry) => entry.key === "noBench")).toBe(false);
    expect(earlierSideControls(doubles, "opponent").some((entry) => entry.key === "noBench")).toBe(true);
    const input = getDoublesTurnInput(doubles);
    expect(input.canSwitch).toBeUndefined();
    expect(input.bench?.own?.map((entry) => entry.id)).toEqual(["test:own:0"]);
    // Removing the last one brings the checkbox back, unticked.
    doubles = removeBenchEntry("own", "test:own:0")(doubles);
    expect(doubles.bench).toBe(NO_BENCH);
    expect(earlierSideControls(doubles, "own").find((entry) => entry.key === "noBench")).toMatchObject({ checked: false });
  });
});

describe("the Bench's rows: HP, Status and its state on the bench", () => {
  it("offers HP from 1 to its maximum (its prepared build's by default) and the build editor's statuses", () => {
    const sv = runtimes[SV];
    let doubles = benched(matchup(sv), "own", entryOf(sv, "own", 0, "snorlax", { currentHP: 100 }));
    const max = getBuildStats(createBuild("snorlax", sv), sv)!.hp;
    expect(rowControl(doubles, "hp")).toMatchObject({ kind: "number", value: 100, min: 1, max, label: "HP" });
    expect(rowControl(doubles, "status")).toMatchObject({ kind: "select", value: "", choices: STATUSES.map((status) => ({ value: status.value, label: status.label })) });
    doubles = apply(doubles, rowControl(doubles, "hp"), 9999);
    expect(doubles.bench.own[0].hp).toBe(max);
    doubles = apply(doubles, rowControl(doubles, "hp"), 0);
    expect(doubles.bench.own[0].hp).toBe(1);
    // An emptied field changes nothing.
    expect(apply(doubles, rowControl(doubles, "hp"), null)).toBe(doubles);
    doubles = apply(doubles, rowControl(doubles, "status"), "brn");
    expect(benchBuild(doubles.bench.own[0])).toMatchObject({ currentHP: 1, status: "brn" });
    // A full-HP prepared build shows its maximum.
    expect(rowControl(benched(matchup(sv), "own", entryOf(sv, "own", 0, "snorlax")), "hp")).toMatchObject({ value: max });
  });

  it("offers its sleep and freeze counters and generation 9's once-a-battle entry abilities only where they apply", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      let doubles = benched(matchup(runtime), "own", entryOf(runtime, "own", 0, "snorlax"));
      expect(rowControl(doubles, "sleep"), game).toBeUndefined();
      doubles = apply(doubles, rowControl(doubles, "status"), "slp");
      const sleep = rowControl(doubles, "sleep");
      expect(sleep && sleep.kind === "select" ? sleep.choices.map((choice) => choice.value) : null, game).toEqual(game === CH ? ["0", "1", "2"] : ["0", "1", "2", "3"]);
      doubles = apply(doubles, sleep, "2");
      doubles = apply(doubles, rowControl(doubles, "rest"), true);
      // Rest's sleep lasts 3: at most 2 turns lost, so 2 stays.
      expect(doubles.bench.own[0].carried).toEqual({ sleep: { attempts: 2, rest: true } });
      // Another status drops the counter.
      doubles = apply(doubles, rowControl(doubles, "status"), "frz");
      expect(doubles.bench.own[0].carried).toBeUndefined();
      expect(!!rowControl(doubles, "freeze"), game).toBe(game === CH);
      if (game === CH) {
        doubles = apply(doubles, rowControl(doubles, "freeze"), "2");
        expect(doubles.bench.own[0].carried).toEqual({ freeze: { attempts: 2 } });
      }
      const sword = holder(runtime, "intrepidsword");
      if (!sword) continue;
      let zacian = benched(matchup(runtime), "own", entryOf(runtime, "own", 0, sword, { abilityId: "intrepidsword" }));
      const once = rowControl(zacian, "once");
      expect(!!once, game).toBe(game === SV || game === CH);
      if (once) {
        expect(once.label).toBe("Intrepid Sword used");
        zacian = apply(zacian, once, true);
        expect(getDoublesTurnInput(zacian).bench?.own?.[0].carried).toEqual({ onceUsed: ["intrepidsword"] });
      }
    }
  });

  it("shows the turn's issue about a bench Pokémon on its row", () => {
    const sv = runtimes[SV];
    const doubles = benched(matchup(sv), "own", entryOf(sv, "own", 0, "snorlax"), entryOf(sv, "own", 1, "corviknight"));
    // A row's HP outside its bounds only comes from outside the controls: the engine's issue names the bench Pokémon.
    const broken = { ...doubles, bench: { ...doubles.bench, own: [doubles.bench.own[0], { ...doubles.bench.own[1], hp: 9999 }] } };
    const result = calculateDoublesTurn(getDoublesTurnInput(broken));
    expect(result.status).toBe("issues");
    const issues = result.status === "issues" ? result.issues : null;
    expect(issues?.field).toEqual([{ field: "bench.own.1", message: expect.stringMatching(/^Bench Corviknight: Current HP must be a whole number from 1 to \d+\.$/) }]);
    const view = benchSideView(broken, "own", [], issues?.field);
    expect(view.rows[0].issue).toBeUndefined();
    expect(view.rows[1].issue).toMatch(/^Bench Corviknight: /);
    const html = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles: broken, issues, apply: () => undefined } }, createElement(BenchFields, { id: "b", side: "own" })));
    expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*data-doubles-bench-hp="own-1"/);
    expect(text(html)).toContain("Bench Corviknight: Current HP must be");
  });
});

describe("Replacement (IN §5.7)", () => {
  it("is offered to a Pokémon that can switch out by its player's choice while its side has a bench, by name, with the turn's default", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      let doubles = matchup(runtime, { "own-left": uturner(runtime), "own-right": { species: "snorlax", item: "ejectbutton" } });
      expect(slotControl(doubles, "replacement"), game).toBeUndefined();
      doubles = benched(doubles, "own", entryOf(runtime, "own", 0, "snorlax"), entryOf(runtime, "own", 1, "snorlax"));
      const replacement = slotControl(doubles, "replacement");
      // Two Snorlax on the bench beside a Snorlax in play: numbered after it.
      expect(replacement).toMatchObject({ kind: "select", label: "Replacement", attr: "data-doubles-replacement", attrValue: "own-left", value: "", toggle: false });
      expect(replacement?.kind === "select" && replacement.choices).toEqual([
        { value: "", label: "Next on the bench" }, { value: "test:own:0", label: "Snorlax (2)" }, { value: "test:own:1", label: "Snorlax (3)" },
      ]);
      expect(slotControl(doubles, "replacement", "own-right")).toBeDefined();
      // A foe has no replacement from this bench; nor a Pokémon that cannot switch out.
      expect(slotControl(doubles, "replacement", "opponent-left")).toBeUndefined();
      const idle = { ...doubles, actions: { ...doubles.actions, "own-left": { moveId: null, target: null } } };
      expect(slotControl(idle, "replacement")).toBeUndefined();
      // At its default the input has none (the engine's default and its fact); a pick is passed.
      expect(getDoublesTurnInput(doubles).replacement).toBeUndefined();
      doubles = apply(doubles, replacement, "test:own:1");
      expect(doubles.bench.picks).toEqual({ "own-left": "test:own:1" });
      expect(getDoublesTurnInput(doubles).replacement).toEqual({ "own-left": "test:own:1" });
      // Shown while set, though it can no longer switch out.
      const stopped = { ...doubles, actions: { ...doubles.actions, "own-left": { moveId: null, target: null } } };
      expect(slotControl(stopped, "replacement")).toMatchObject({ value: "test:own:1" });
      // Back to the default.
      expect(apply(doubles, slotControl(doubles, "replacement"), "").bench.picks).toEqual({});
    }
  });

  it("goes when its bench Pokémon leaves the bench, or when another Pokémon takes the slot", () => {
    const sv = runtimes[SV];
    let doubles = benched(matchup(sv, { "own-left": uturner(sv) }), "own", entryOf(sv, "own", 0, "snorlax"), entryOf(sv, "own", 1, "corviknight"));
    doubles = setBenchPick("own-left", "test:own:1")(doubles);
    expect(removeBenchEntry("own", "test:own:0")(doubles).bench.picks).toEqual({ "own-left": "test:own:1" });
    expect(removeBenchEntry("own", "test:own:1")(doubles).bench.picks).toEqual({});
    expect(clearSlotEarlier(doubles, "own-left").bench.picks).toEqual({});
    expect(clearSlotEarlier(doubles, "own-right").bench).toBe(doubles.bench);
  });
});

describe("Hazards (IN §5.7)", () => {
  it("offers each hazard the game has for a side whose bench is set and one of whose Pokémon can come in, or while set", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const reader = matchup(runtime, { "own-left": uturner(runtime) });
      expect(hazardControls(reader, "own"), game).toEqual([]);
      const doubles = benched(reader, "own", entryOf(runtime, "own", 0, "snorlax"));
      const shown = hazardControls(doubles, "own").map((entry) => entry.label);
      const expected = [["stealthrock", "Stealth Rock"], ["spikes", "Spikes"], ["toxicspikes", "Toxic Spikes"], ["stickyweb", "Sticky Web"], ["gmaxsteelsurge", "G-Max Steelsurge"]]
        .filter(([id]) => runtime.movesById.has(id) && (id !== "gmaxsteelsurge" || game === SWSH)).map(([, label]) => label);
      expect(shown, game).toEqual(expected);
      expect(shown.includes("G-Max Steelsurge")).toBe(game === SWSH);
      // The other side has no bench: none, until one is set.
      expect(hazardControls(doubles, "opponent")).toEqual([]);
      const idle = benched(matchup(runtime), "own", entryOf(runtime, "own", 0, "snorlax"));
      expect(hazardControls(idle, "own")).toEqual([]);
      const set = setBenchHazards("own", { stealthRock: true })(idle);
      expect(hazardControls(set, "own").map((entry) => entry.label)).toEqual(["Stealth Rock"]);
    }
  });

  it("writes Stealth Rock, Spikes layers, Toxic Spikes layers, Sticky Web and Steelsurge, each counting among the toggles", () => {
    const swsh = runtimes[SWSH];
    let doubles = benched(matchup(swsh, { "own-left": uturner(swsh) }), "own", entryOf(swsh, "own", 0, "snorlax"));
    const spikes = hazard(doubles, "spikes");
    expect(spikes?.kind === "select" && spikes.choices.map((choice) => choice.value)).toEqual(["0", "1", "2", "3"]);
    const toxic = hazard(doubles, "toxicSpikes");
    expect(toxic?.kind === "select" && toxic.choices.map((choice) => choice.value)).toEqual(["0", "1", "2"]);
    expect(hazard(doubles, "stealthRock")).toMatchObject({ kind: "check", attr: "data-doubles-hazard-stealth-rock", attrValue: "own" });
    const before = earlierTurnToggles(doubles);
    doubles = apply(doubles, hazard(doubles, "stealthRock"), true);
    doubles = apply(doubles, hazard(doubles, "spikes"), "3");
    doubles = apply(doubles, hazard(doubles, "toxicSpikes"), "2");
    doubles = apply(doubles, hazard(doubles, "stickyWeb"), true);
    doubles = apply(doubles, hazard(doubles, "steelsurge"), true);
    expect(doubles.bench.hazards).toEqual({ own: { stealthRock: true, spikes: 3, toxicSpikes: 2, stickyWeb: true, steelsurge: true } });
    expect(getDoublesTurnInput(doubles).hazards).toEqual({ own: { stealthRock: true, spikes: 3, toxicSpikes: 2, stickyWeb: true, steelsurge: true } });
    expect(earlierTurnToggles(doubles)).toBe(before + 5);
    // 0 layers and an unticked box remove each one.
    doubles = apply(doubles, hazard(doubles, "spikes"), "0");
    doubles = apply(doubles, hazard(doubles, "stealthRock"), false);
    expect(doubles.bench.hazards).toEqual({ own: { toxicSpikes: 2, stickyWeb: true, steelsurge: true } });
    for (const flag of ["toxicSpikes", "stickyWeb", "steelsurge"]) doubles = apply(doubles, hazard(doubles, flag), flag === "toxicSpikes" ? "0" : false);
    expect(doubles.bench.hazards).toEqual({});
    expect(getDoublesTurnInput(doubles).hazards).toBeUndefined();
  });
});

describe("Lands this turn over the bench (ADDENDUM2 §5.3)", () => {
  it("lists a bench learner of either side by its bench name, and passes its build as it is on the bench", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const seer = learner(runtime, "futuresight");
      if (!seer) continue;
      let doubles = matchup(runtime);
      expect(slotControl(doubles, "futureMove"), game).toBeUndefined();
      doubles = benched(doubles, "opponent", entryOf(runtime, "opponent", 0, seer, { currentHP: 50 }));
      const control = slotControl(doubles, "futureMove");
      const name = benchNamesOf(doubles)["test:opponent:0"];
      expect(control?.kind === "select" && control.choices).toEqual([{ value: "", label: "None" }, { value: "bench:futuresight:opponent:0", label: `Future Sight from ${name}` }]);
      doubles = apply(doubles, control, "bench:futuresight:opponent:0");
      expect(doubles.history["own-left"].futureFrom).toBe("test:opponent:0");
      expect(getDoublesTurnInput(doubles).pokemon["own-left"]?.carried?.futureMove).toEqual({ move: "futuresight", build: benchBuild(doubles.bench.opponent[0]) });
      expect(slotControl(doubles, "futureMove")).toMatchObject({ value: "bench:futuresight:opponent:0" });
      // It follows the bench Pokémon's build, and goes when it leaves the bench.
      doubles = setBenchEntry("opponent", "test:opponent:0", { hp: 20 })(doubles);
      const future = doubles.carried["own-left"].futureMove;
      expect(typeof future === "object" && "build" in future ? future.build.currentHP : null).toBe(20);
      const gone = removeBenchEntry("opponent", "test:opponent:0")(doubles);
      expect(gone.carried["own-left"].futureMove).toBeUndefined();
      expect(gone.history["own-left"].futureFrom).toBeUndefined();
      // Choosing None clears both.
      const none = apply(doubles, slotControl(doubles, "futureMove"), "");
      expect([none.carried["own-left"].futureMove, none.history["own-left"].futureFrom]).toEqual([undefined, undefined]);
      // The engine accepts the landing from a bench build.
      expect(calculateDoublesTurn(getDoublesTurnInput(doubles)).status, game).not.toBe("issues");
    }
  });
});

describe("the mapping into the turn's input (IN §5.7)", () => {
  it("leaves every turn without a bench, pick or hazard as it was", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const doubles = matchup(runtime, { "own-left": uturner(runtime) });
      expect(doubles.bench).toBe(NO_BENCH);
      const input = getDoublesTurnInput(doubles);
      expect(withBench(input, NO_BENCH)).toBe(input);
      expect(withBench(input, undefined)).toBe(input);
      expect(input).not.toHaveProperty("bench");
      expect(input).not.toHaveProperty("replacement");
      expect(input).not.toHaveProperty("hazards");
      // A bench emptied again is no bench.
      const emptied = removeBenchEntry("own", "test:own:0")(benched(doubles, "own", entryOf(runtime, "own", 0, "snorlax")));
      expect(emptied.bench).toBe(NO_BENCH);
      expect(JSON.stringify(getDoublesTurnInput(emptied))).toBe(JSON.stringify(input));
    }
  });

  it("passes each side's bench in roster order with its build, moves and state, the picks on it and the hazards", () => {
    const sv = runtimes[SV];
    let doubles = matchup(sv, { "own-left": uturner(sv) });
    const order = ["test:own:2", "test:own:0", "test:own:1"];
    doubles = addBenchEntry("own", entryOf(sv, "own", 0, "snorlax", {}, ["bodyslam", "rest", "bodyslam"]), order)(doubles);
    doubles = addBenchEntry("own", entryOf(sv, "own", 1, "corviknight"), order)(doubles);
    doubles = addBenchEntry("own", entryOf(sv, "own", 2, "garchomp", { status: "slp" }), order)(doubles);
    doubles = setBenchEntry("own", "test:own:2", { carried: { sleep: { attempts: 1, rest: false } } })(doubles);
    doubles = setBenchPick("own-left", "test:own:0")(doubles);
    // A pick of a key not on its side's bench is not passed (only stale state could hold one).
    doubles = { ...doubles, bench: { ...doubles.bench, picks: { ...doubles.bench.picks, "own-right": "nowhere" } } };
    const input = getDoublesTurnInput(doubles);
    expect(input.bench?.own?.map((entry) => entry.id)).toEqual(["test:own:2", "test:own:0", "test:own:1"]);
    expect(input.bench).not.toHaveProperty("opponent");
    expect(input.bench?.own?.[0]).toEqual({ id: "test:own:2", build: doubles.bench.own[0].base, carried: { sleep: { attempts: 1, rest: false } } });
    expect(input.bench?.own?.[1]).toEqual({ id: "test:own:0", build: doubles.bench.own[1].base, moves: ["bodyslam", "rest"] });
    expect(input.replacement).toEqual({ "own-left": "test:own:0" });
    expect(input.canSwitch).toBeUndefined();
    expect(turnBenchNames(input)).toEqual({ "test:own:2": "Garchomp", "test:own:0": "Snorlax", "test:own:1": "Corviknight" });
    expect(benchNamesOf(doubles)).toEqual(turnBenchNames(input));
  });

  it("passes a bench build without a Dynamax the session's build kept, and with its Terastallization (review 2 R7-3)", () => {
    // Dynamax ends at BeforeSwitchOut (PS/data/conditions.ts dynamax) and a newcomer has no action to start one; a
    // Terastallized Pokémon stays so on the bench.
    const swsh = runtimes[SWSH];
    let doubles = matchup(swsh, { "own-left": uturner(swsh) });
    doubles = addBenchEntry("own", entryOf(swsh, "own", 0, "snorlax", { mechanic: "dynamax" }), [])(doubles);
    doubles = addBenchEntry("own", entryOf(swsh, "own", 1, "corviknight", { mechanic: "gigantamax" }), [])(doubles);
    const input = getDoublesTurnInput(doubles);
    expect(input.bench?.own?.map((entry) => entry.build.mechanic ?? null)).toEqual([null, null]);
    expect(input.bench?.own?.every((entry) => !("mechanic" in entry.build))).toBe(true);
    expect(calculateDoublesTurn(input).status).not.toBe("issues");
    const sv = runtimes[SV];
    const tera = addBenchEntry("own", entryOf(sv, "own", 0, "charizard", { mechanic: "tera", configuration: { teraType: "Steel" } }), [])(matchup(sv, { "own-left": uturner(sv) }));
    expect(getDoublesTurnInput(tera).bench?.own?.[0].build.mechanic).toBe("tera");
    expect(benchBuild(tera.bench!.own[0])).toBe(tera.bench!.own[0].base);
  });

  it("holds at most four on a side, never one twice nor one in play on its side", () => {
    const sv = runtimes[SV];
    let doubles = matchup(sv);
    for (let index = 0; index < 5; index += 1) doubles = addBenchEntry("own", entryOf(sv, "own", index, "snorlax"), [])(doubles);
    expect(doubles.bench.own.map((entry) => entry.key)).toEqual(["test:own:0", "test:own:1", "test:own:2", "test:own:3"]);
    expect(addBenchEntry("own", entryOf(sv, "own", 0, "snorlax"), [])(doubles)).toBe(doubles);
    const playing = { ...matchup(sv), slots: { ...matchup(sv).slots, "own-left": { ...matchup(sv).slots["own-left"], source: sourceOf(sv, "own", 0, "snorlax") } } };
    expect(addBenchEntry("own", entryOf(sv, "own", 0, "snorlax"), [])(playing)).toBe(playing);
    expect(benchSideView(doubles, "own", [choiceOf(sourceOf(sv, "own", 9, "snorlax"))])).toMatchObject({ full: true, add: [{ value: "test:own:9", label: "Snorlax" }] });
  });

  it("writes only values the turn's validation accepts, in every game", () => {
    for (const game of GAMES) {
      const runtime = runtimes[game];
      const sleeper = entryOf(runtime, "own", 0, "snorlax", { status: "slp", currentHP: 120 }, ["bodyslam"]);
      const sword = holder(runtime, "intrepidsword");
      let doubles = matchup(runtime, { "own-left": uturner(runtime), "opponent-left": { species: learner(runtime, "roar")!, action: "roar", target: "own-right" } });
      doubles = benched(doubles, "own", sleeper, ...(sword ? [entryOf(runtime, "own", 1, sword, { abilityId: "intrepidsword" })] : [entryOf(runtime, "own", 1, "garchomp")]));
      doubles = benched(doubles, "opponent", entryOf(runtime, "opponent", 0, "snorlax", { status: "frz" }));
      const values: [string, () => EarlierControl | undefined, (boolean | string | number)[]][] = [
        ["hp", () => rowControl(doubles, "hp"), [1, 60]],
        ["sleep", () => rowControl(doubles, "sleep"), ["1", "2", "3"].slice(0, game === CH ? 2 : 3)],
        ["rest", () => rowControl(doubles, "rest"), [true]],
        ["once", () => rowControl(doubles, "once", 1), [true]],
        ["freeze", () => rowControl(doubles, "freeze", 0, "opponent"), ["1", "2"]],
        ["replacement", () => slotControl(doubles, "replacement"), ["test:own:0", "test:own:1"]],
        ...EARLIER_TABLES.hazards.map(({ flag, most }): [string, () => EarlierControl | undefined, (boolean | string)[]] => [flag, () => hazard(doubles, flag), most === 1 ? [true] : ["1", String(most)]]),
      ];
      let applied = 0;
      for (const [what, find, list] of values) {
        for (const value of list) {
          const control = find();
          if (!control) continue;
          applied += 1;
          doubles = apply(doubles, control, value);
          const result = calculateDoublesTurn(getDoublesTurnInput(doubles));
          const own = result.status === "issues" ? [...Object.values(result.issues.pokemon).flat(), ...result.issues.field].map((issue) => `${issue.field}: ${issue.message}`) : [];
          expect(own, `${game} ${what} = ${String(value)}`).toEqual([]);
        }
      }
      // HP, sleep, the replacements and the hazards everywhere; Rest sleep, Intrepid Sword and freeze where they apply.
      expect(applied, game).toBeGreaterThanOrEqual(game === CH ? 15 : game === SV ? 14 : 11);
    }
  }, 60_000);
});

// ---------- the state rules through doubles-prep (Champions, league rosters) ----------

function team(id: string, memberId: string, names: string[]): TeamRoster {
  return { id, member_id: memberId, total_points: names.length * 15, team_name: null, role: null, pokemon: names.map((name, index) => ({ name, points: 15, tier: 1, pick_number: index + 1, acquired: "draft" })) };
}
function loaded(overrides: Partial<CalculatorRosterState> = {}): CalculatorRosterState {
  return {
    status: "ready", userId: "user-account", selectedLeagueId: "league-a", opponentId: "member-other",
    leagues: [{ id: "league-a", name: "Alpha", memberId: "member-own", teamName: "Home", draftStarted: true, draftCompleted: true }],
    teamsStatus: "ready", message: null, teamsMessage: null,
    data: {
      leagueId: "league-a",
      members: [
        { id: "member-own", role: "coach", team_name: "Home", draft_position: 1 },
        { id: "member-other", role: "coach", team_name: "Away", draft_position: 2 },
        { id: "member-third", role: "coach", team_name: "Third", draft_position: 3 },
      ],
      teams: [
        team("team-own", "member-own", ["Garchomp", "Incineroar", "Gardevoir", "Corviknight", "Snorlax", "Alakazam", "Talonflame"]),
        team("team-other", "member-other", ["Gyarados", "Venusaur", "Golisopod", "Skarmory"]),
        team("team-third", "member-third", ["Snorlax"]),
      ],
    },
    ...overrides,
  };
}
const start = (rosters = loaded()): CalculatorState => ({ matchup: reconcileRosters(createMatchup(), rosters), doubles: createDoubles() });
const panel = (state: CalculatorState, role: RosterRole, rosters = loaded()) => getTeamPanel(state.matchup, rosters, role).choices;
const pick = (state: CalculatorState, role: RosterRole, name: string) => panel(state, role).find((entry) => entry.name === name)!;
const keyOf = (state: CalculatorState, slot: DoublesSlotId) => state.doubles.slots[slot].key;
function on1v1(state: CalculatorState, update: (matchup: PreparedMatchup) => PreparedMatchup, rosters?: CalculatorRosterState): CalculatorState {
  const matchup = update(state.matchup);
  return { matchup, doubles: followShared(state.doubles, state.matchup, matchup, rosters) };
}
/** Incineroar in own-left using Parting Shot: your side can come in. */
function partingShot(state: CalculatorState) {
  const next = selectDoublesRoster(state, keyOf(state, "own-left"), pick(state, "own", "Incineroar"));
  return chooseDoublesMove(next, getMoveOwner(next.doubles.slots["own-left"]), "partingshot");
}
const add = (state: CalculatorState, role: RosterRole, name: string) => addDoublesBench(state, role, pick(state, role, name), panel(state, role));

describe("the Bench's state rules (IN §5.4, §5.7)", () => {
  it("adds a roster entry prepared as a roster pick is, in roster order, without storing it in the shared cache", () => {
    let state = partingShot(start());
    const view = benchSideView(state.doubles, "own", panel(state, "own"));
    expect(view.shown).toBe(true);
    expect(view.add.map((choice) => choice.label)).toEqual(["Garchomp", "Gardevoir", "Corviknight", "Snorlax", "Alakazam", "Talonflame"]);
    // A session build edit of Garchomp's roster entry is its bench build.
    const garchomp = pick(state, "own", "Garchomp");
    const tuned = selectRosterPokemon(state.matchup, "attacker", garchomp);
    state = { ...state, matchup: { ...state.matchup, cache: new Map(state.matchup.cache).set(garchomp.source!.key, { ...tuned.cache.get(garchomp.source!.key)!, build: { ...tuned.attacker.build, nature: "Adamant" } }) } };
    const cache = state.matchup.cache;
    state = add(state, "own", "Snorlax");
    state = add(state, "own", "Garchomp");
    expect(state.matchup.cache).toBe(cache);
    expect(state.doubles.bench.own.map((entry) => entry.source?.name)).toEqual(["Garchomp", "Snorlax"]);
    expect(state.doubles.bench.own[0].base.nature).toBe("Adamant");
    // Snorlax's default build and its Doubles quick moves (Assist's party).
    expect(state.doubles.bench.own[1].base.speciesId).toBe("snorlax");
    expect(state.doubles.bench.own[1].moves.length).toBeGreaterThan(0);
    expect(benchSideView(state.doubles, "own", panel(state, "own")).add.map((choice) => choice.label)).toEqual(["Gardevoir", "Corviknight", "Alakazam", "Talonflame"]);
    // Not twice, not one in play, at most four.
    expect(add(state, "own", "Garchomp")).toBe(state);
    expect(add(state, "own", "Incineroar")).toBe(state);
    state = add(add(state, "own", "Gardevoir"), "own", "Alakazam");
    expect(state.doubles.bench.own).toHaveLength(4);
    expect(add(state, "own", "Talonflame")).toBe(state);
    expect(benchSideView(state.doubles, "own", panel(state, "own"))).toMatchObject({ full: true });
    // The turn's input names them after the four in play.
    expect(Object.values(turnBenchNames(getDoublesTurnInput(state.doubles)))).toEqual(["Garchomp", "Gardevoir", "Snorlax", "Alakazam"]);
  });

  it("takes a bench Pokémon off the bench when it is put into play, and says so", () => {
    let state = add(partingShot(start()), "own", "Snorlax");
    state = selectDoublesRoster(state, keyOf(state, "own-right"), pick(state, "own", "Snorlax"));
    expect(state.doubles.slots["own-right"].source?.name).toBe("Snorlax");
    expect(state.doubles.bench).toBe(NO_BENCH);
    expect(state.doubles.notice).toBe("Snorlax selected in place of Venusaur. Default build loaded. Field settings are unchanged; move contexts cleared. Snorlax is no longer on the bench.");
  });

  it("removes the bench Pokémon a roster or opponent change no longer offers, with their picks", () => {
    let state = partingShot(start());
    state = add(add(state, "own", "Snorlax"), "opponent", "Golisopod");
    state = { ...state, doubles: setBenchPick("own-left", state.doubles.bench.own[0].key)(state.doubles) };
    const rosters = loaded({ opponentId: "member-third" });
    const next = on1v1(state, (matchup) => reconcileRosters(matchup, rosters), rosters);
    expect(next.doubles.bench.opponent).toEqual([]);
    expect(next.doubles.bench.own).toBe(state.doubles.bench.own);
    expect(next.doubles.bench.picks).toEqual(state.doubles.bench.picks);
    // The same roster again changes nothing.
    const same = loaded();
    expect(followShared(state.doubles, state.matchup, reconcileRosters(state.matchup, same), same)).toBe(state.doubles);
  });

  it("follows a session build edit of a bench Pokémon's roster entry, keeping the row's HP and status", () => {
    let state = add(partingShot(start()), "own", "Garchomp");
    state = { ...state, doubles: setBenchEntry("own", state.doubles.bench.own[0].key, { hp: 50, status: "par" })(state.doubles) };
    state = on1v1(state, (matchup) => selectRosterPokemon(matchup, "attacker", pick(state, "own", "Garchomp")));
    state = on1v1(state, (matchup) => updateMatchupBuild(matchup, "attacker", { ...matchup.attacker.build, nature: "Jolly" }));
    expect(state.doubles.bench.own[0].base.nature).toBe("Jolly");
    expect(benchBuild(state.doubles.bench.own[0])).toMatchObject({ nature: "Jolly", currentHP: 50, status: "par" });
  });

  it("clears the bench on a 2v2 Reset, a game change and an account change", async () => {
    const state = add(partingShot(start()), "own", "Snorlax");
    expect(resetDoubles(state).doubles.bench).toBe(NO_BENCH);
    const sv = await loadBattleRuntime("scarlet_violet");
    expect(on1v1(state, (matchup) => changeBattleGame(matchup, sv)).doubles.bench).toBe(NO_BENCH);
    const account = loaded({ userId: "another-account" });
    expect(on1v1(state, (matchup) => reconcileRosters(matchup, account), account).doubles.bench).toBe(NO_BENCH);
  });
});

// ---------- the switch-in pop-up: Volt Switch with no opponent chosen ----------

describe("the Pokémon a switching move brings in (the switch-in pop-up)", () => {
  const noOpponent = () => loaded({ opponentId: "" });
  /** The default matchup with no opponent chosen: the opponent's Pikachu uses Volt Switch, the other three no move. */
  function voltSwitch(): CalculatorState {
    const state = start(noOpponent());
    const pikachu = state.doubles.slots["opponent-right"];
    expect(pikachu.build.speciesId).toBe("pikachu");
    return chooseDoublesMove(state, getMoveOwner(pikachu), "voltswitch");
  }
  const turnOf = (state: CalculatorState) => calculateDoublesTurn(getDoublesTurnInput(state.doubles));

  it("reproduces the report: with no Pokémon named to come in, the turn is not estimated, so the pop-up asks", () => {
    const state = voltSwitch();
    expect(panel(state, "opponent", noOpponent())).toEqual([]);
    expect(turnOf(state)).toMatchObject({ status: "not-estimated", reason: "Pikachu switches out: the replacement is not known." });
    expect(asksSwitchIn(state.doubles, "opponent-right", "voltswitch")).toBe(true);
    expect(switchInOf(state.doubles, "opponent-right")).toEqual({ state: "unknown" });
    // Pikachu's other moves do not switch it out; a Pokémon that does not switch has no Switch-in.
    expect(asksSwitchIn(state.doubles, "opponent-right", "nuzzle")).toBe(false);
    expect(asksSwitchIn(state.doubles, "opponent-right", null)).toBe(false);
    expect(switchInOf(state.doubles, "own-left")).toBeNull();
  });

  it("brings in any Pokémon of the game, a team Pokémon or a bench Pokémon, and the turn is estimated with it", () => {
    let state = chooseDoublesSwitchIn(voltSwitch(), "opponent-right", { kind: "species", speciesId: "garchomp" });
    const [entry] = state.doubles.bench.opponent;
    // Garchomp joins the bench with the build Change Pokémon gives it in a slot, and is Pikachu's pick.
    expect(entry).toMatchObject({ key: "chosen:opponent:garchomp", source: null, base: { speciesId: "garchomp", abilityId: usualAbility("garchomp", "Doubles", championsRuntime) } });
    expect(entry.moves).toEqual(createMoveSlots("garchomp", "Doubles", championsRuntime).flatMap((move) => move.moveId ? [move.moveId] : []));
    expect(state.doubles.bench.picks).toEqual({ "opponent-right": "chosen:opponent:garchomp" });
    expect(switchInOf(state.doubles, "opponent-right")).toEqual({ state: "picked", key: "chosen:opponent:garchomp", name: "Garchomp" });
    expect(asksSwitchIn(state.doubles, "opponent-right", "voltswitch")).toBe(false);
    const turn = turnOf(state);
    expect(turn.status).toBe("ready");
    if (turn.status !== "ready") return;
    expect(turn.replaced?.["opponent-right"]?.entered).toEqual([{ id: "chosen:opponent:garchomp", chance: 1 }]);
    expect(turnSummary(turn, namesOf(state.doubles), "average", benchNamesOf(state.doubles))).toMatch(/Pikachu switches out at 110 HP\. Garchomp comes in\. Garchomp HP remaining: \d+ \/ \d+\./);
    // A second pick from the bench changes the pick only.
    state = chooseDoublesSwitchIn(state, "opponent-right", { kind: "species", speciesId: "snorlax" });
    state = chooseDoublesSwitchIn(state, "opponent-right", { kind: "bench", key: "chosen:opponent:garchomp" });
    expect(state.doubles.bench.opponent.map((each) => each.key)).toEqual(["chosen:opponent:garchomp", "chosen:opponent:snorlax"]);
    expect(state.doubles.bench.picks).toEqual({ "opponent-right": "chosen:opponent:garchomp" });
    // Your side has a team: Incineroar's Parting Shot brings in Garchomp from it, in roster order on the bench.
    let own = partingShot(start());
    expect(asksSwitchIn(own.doubles, "own-left", "partingshot")).toBe(true);
    own = chooseDoublesSwitchIn(own, "own-left", { kind: "team", choice: pick(own, "own", "Garchomp"), roster: panel(own, "own") });
    expect(own.doubles.bench.own.map((each) => each.source?.name)).toEqual(["Garchomp"]);
    expect(switchInOf(own.doubles, "own-left")).toMatchObject({ state: "picked", name: "Garchomp" });
    expect(turnOf(own).status).not.toBe("not-estimated");
  });

  it("keeps Pikachu in with No Pokémon left, and changes nothing for a fifth bench Pokémon", () => {
    const none = chooseDoublesSwitchIn(voltSwitch(), "opponent-right", { kind: "none" });
    expect(none.doubles.turnEarlier.noneLeft).toEqual({ opponent: true });
    expect(switchInOf(none.doubles, "opponent-right")).toEqual({ state: "none" });
    expect(asksSwitchIn(none.doubles, "opponent-right", "voltswitch")).toBe(false);
    expect(turnOf(none).status).toBe("ready");
    let full = voltSwitch();
    for (const species of ["garchomp", "snorlax", "gyarados", "corviknight"]) full = addChosenDoublesBench(full, "opponent", species);
    expect(chooseDoublesSwitchIn(full, "opponent-right", { kind: "species", speciesId: "alakazam" })).toBe(full);
    // With a bench and no pick, the turn's default is the first bench Pokémon.
    expect(switchInOf(full.doubles, "opponent-right")).toEqual({ state: "next", key: "chosen:opponent:garchomp", name: "Garchomp" });
    expect(asksSwitchIn(full.doubles, "opponent-right", "voltswitch")).toBe(true);
  });

  it("offers its side's bench (with HP and status), its team, and No Pokémon left while the bench is empty", () => {
    const empty = switchInOptions(voltSwitch().doubles, "opponent-right", []);
    expect(empty).toEqual({ bench: [], current: null, team: [], full: false, noneLeft: true });
    let state = chooseDoublesSwitchIn(voltSwitch(), "opponent-right", { kind: "species", speciesId: "garchomp" });
    state = { ...state, doubles: setBenchEntry("opponent", "chosen:opponent:garchomp", { hp: 90, status: "brn" })(state.doubles) };
    const max = getBuildStats(state.doubles.bench.opponent[0].base, championsRuntime)!.hp;
    expect(switchInOptions(state.doubles, "opponent-right", [])).toEqual({
      bench: [{ key: "chosen:opponent:garchomp", name: "Garchomp", detail: `90 / ${max} HP · Burned` }], current: "chosen:opponent:garchomp", team: [], full: false, noneLeft: false,
    });
    // Your side lists its team Pokémon not in play and not on the bench, in roster order.
    const own = partingShot(start());
    expect(switchInOptions(own.doubles, "own-left", panel(own, "own")).team.map((each) => each.name)).toEqual(["Garchomp", "Gardevoir", "Corviknight", "Snorlax", "Alakazam", "Talonflame"]);
  });

  it("does not ask for a switching move used as a Max Move or a damaging Z-Move, or Teleport in Ultra Sun/Ultra Moon", () => {
    const swsh = runtimes[SWSH], usum = runtimes[USUM];
    expect(asksSwitchIn(matchup(swsh, { "own-left": uturner(swsh) }), "own-left", "uturn")).toBe(true);
    expect(asksSwitchIn(matchup(swsh, { "own-left": { ...uturner(swsh), mechanic: "dynamax" } }), "own-left", "uturn")).toBe(false);
    expect(asksSwitchIn(matchup(usum, { "own-left": { ...uturner(usum), useZ: true } }), "own-left", "uturn")).toBe(false);
    const teleporter = learner(usum, "teleport");
    if (teleporter) expect(asksSwitchIn(matchup(usum, { "own-left": { species: teleporter, action: "teleport", target: null } }), "own-left", "teleport")).toBe(false);
  });

  it("adds each Pokémon chosen by name once, at most four, only of the game, and keeps them through a roster change", () => {
    const state = voltSwitch();
    let next = addChosenDoublesBench(state, "opponent", "garchomp");
    expect(addChosenDoublesBench(next, "opponent", "garchomp")).toBe(next);
    expect(addChosenDoublesBench(next, "opponent", "not-a-pokemon")).toBe(next);
    for (const species of ["snorlax", "gyarados", "corviknight"]) next = addChosenDoublesBench(next, "opponent", species);
    expect(next.doubles.bench.opponent.map((each) => each.key)).toEqual(["chosen:opponent:garchomp", "chosen:opponent:snorlax", "chosen:opponent:gyarados", "chosen:opponent:corviknight"]);
    expect(addChosenDoublesBench(next, "opponent", "alakazam")).toBe(next);
    expect(benchSideView(next.doubles, "opponent", [])).toMatchObject({ full: true, choose: true });
    // Choosing an opponent later keeps them, as a slot keeps a Pokémon chosen by name.
    const rosters = loaded();
    const chosen = on1v1(next, (matchup) => reconcileRosters(matchup, rosters), rosters);
    expect(chosen.doubles.bench.opponent).toBe(next.doubles.bench.opponent);
    // A Pokémon on the bench ends No Pokémon left to switch in, as a roster one does.
    const none = chooseDoublesSwitchIn(state, "opponent-right", { kind: "none" });
    expect(addChosenDoublesBench(none, "opponent", "garchomp").doubles.turnEarlier.noneLeft).toBeUndefined();
  });

  it("keeps Add to bench (the Pokémon search) in Field conditions for a side with no roster, and no Set bench in the turn", () => {
    const state = voltSwitch();
    const html = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles: state.doubles, issues: null, apply: () => undefined, rosters: { own: [], opponent: [] }, update: () => undefined } },
      createElement(BenchFields, { id: "b", side: "opponent" })));
    expect(html).toMatch(/<button[^>]*data-doubles-bench-add="opponent"/);
    expect(text(html)).toContain("Add to bench: the opponent's side");
    const doubles = state.doubles;
    const cards = {} as Record<DoublesSlotId, DoublesCardView>;
    for (const slot of DOUBLES_SLOTS) {
      cards[slot] = {
        id: slot, slot: doubles.slots[slot], action: doubles.actions[slot], rule: null, hp: null, afterTurn: false, reached: true,
        issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null, switches: null,
      };
    }
    const panelHtml = renderToStaticMarkup(createElement(DoublesTurn, { runtime: championsRuntime, names: namesOf(doubles), cards, turn: turnOf(state), rollMode: "average", movesControl: "moves", onShowStep: vi.fn(), onFixSettings: vi.fn() }));
    expect(text(panelHtml)).toContain("Turn not estimated: Pikachu switches out: the replacement is not known.");
    expect(panelHtml).not.toMatch(/Set bench|data-doubles-set-bench/);
  });
});

// ---------- rendering ----------

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const namesOf = (doubles: DoublesMatchup) => doublesNames(doubles.slots, doubles.runtime);

function carriedControls(doubles: DoublesMatchup): CarriedControl[] {
  return DOUBLES_SLOTS.map((slot) => ({
    slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: namesOf(doubles)[slot], value: doubles.carried[slot], options: NO_CARRIED_OPTIONS, onChange: () => undefined,
  }));
}
function page(state: EarlierTurnState) {
  const carried = carriedControls(state.doubles);
  return renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: state },
    createElement(Fragment, null, ...(["attackerSide", "defenderSide"] as const).map((side) => createElement("fieldset", { key: side }, createElement(EarlierTurnFields, { id: "f", side, carried, charge: [] }))))));
}
/** Both sides with a bench and every control set: the busiest Bench (Scarlet/Violet). */
function busy() {
  const sv = runtimes[SV];
  let doubles = matchup(sv, {
    "own-left": uturner(sv), "own-right": { species: "snorlax", item: "ejectbutton" },
    "opponent-left": { species: learner(sv, "roar")!, action: "roar", target: "own-right" }, "opponent-right": { species: "snorlax", item: "redcard" },
  });
  const sword = holder(sv, "intrepidsword")!;
  doubles = benched(doubles, "own", entryOf(sv, "own", 0, "snorlax", { status: "slp" }), entryOf(sv, "own", 1, sword, { abilityId: "intrepidsword" }), entryOf(sv, "own", 2, "snorlax"));
  doubles = benched(doubles, "opponent", entryOf(sv, "opponent", 0, "snorlax"), entryOf(sv, "opponent", 1, "corviknight"));
  doubles = setBenchHazards("own", { stealthRock: true, spikes: 2, toxicSpikes: 1, stickyWeb: true })(doubles);
  doubles = setBenchHazards("opponent", { spikes: 3 })(doubles);
  doubles = setBenchPick("own-right", "test:own:2")(doubles);
  const rosters = { own: [choiceOf(sourceOf(sv, "own", 3, "garchomp"))], opponent: [choiceOf(sourceOf(sv, "opponent", 2, "gyarados"))] };
  return { doubles, rosters };
}

describe("the Bench and Hazards on the page", () => {
  it("names every control by its Pokémon or side, uniquely, with ids and labels that match and no position word", () => {
    const { doubles, rosters } = busy();
    const html = page({ doubles, issues: null, apply: () => undefined, rosters, update: () => undefined });
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) expect(ids).toContain(id);
    for (const [, references] of html.matchAll(/\baria-(?:describedby|labelledby)="([^"]+)"/g)) for (const id of references.split(" ")) expect(ids).toContain(id);
    const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((match) => text(match[1]).trim());
    expect(new Set(labels).size, labels.filter((label, index) => labels.indexOf(label) !== index).join(" | ")).toBe(labels.length);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => text(match[1]).trim());
    // Snorlax stands on both sides, so each bench Snorlax has its team and its number after its side's Snorlax in play.
    const sword = speciesName(runtimes[SV], holder(runtimes[SV], "intrepidsword")!);
    expect(buttons).toEqual(["Remove Snorlax (yours, 2)", `Remove ${sword}`, "Remove Snorlax (yours, 3)", "Remove Snorlax (opponent's, 2)", "Remove Corviknight"]);
    for (const label of ["Bench: your side", "Bench: the opponent's side", "Add to bench: your side", "Add to bench: the opponent's side", "Hazards: your side", "Stealth Rock: your side",
      "Spikes: the opponent's side", "HP: Snorlax (yours, 2)", "Status: Snorlax (opponent's, 2)", "Turns lost to sleep: Snorlax (yours, 2)", "Rest sleep: Snorlax (yours, 2)",
      "Replacement: Snorlax (yours)", `Intrepid Sword used: ${sword}`]) expect(text(html)).toContain(label);
    expect(html).toMatch(/data-doubles-bench="own"/);
    expect(html).toMatch(/data-doubles-hazards="opponent"/);
    expect(html).toMatch(/data-doubles-replacement="own-right"/);
    expect(html).not.toMatch(/data-doubles-no-bench/);
    expect(positionalIn(html)).toEqual([]);
    expect(text(html)).not.toMatch(/\b(own|opponent)-(left|right)\b/);
  });

  it("keeps its checkboxes in two wrapping columns and its selects in the compact fields grid at 375 px", () => {
    const { doubles, rosters } = busy();
    const html = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles, issues: null, apply: () => undefined, rosters, update: () => undefined } },
      createElement(BenchFields, { id: "b", side: "own" })));
    for (const [tag] of html.matchAll(/<label[^>]*class="flex[^"]*"[^>]*>/g)) expect(tag).toMatch(/min-w-0[^"]*wrap-anywhere|wrap-anywhere[^"]*min-w-0/);
    const grids = [...html.matchAll(new RegExp(`<div class="${styles.fields}[^"]*">([\\s\\S]*?)(?=<div class="${styles.fields}|<div class="grid|</li>|<div role="group"|$)`, "g"))].map((match) => match[1]);
    const fields = /<select|<input[^>]*type="number"/g;
    const inGrids = grids.reduce((sum, grid) => sum + (grid.match(fields) ?? []).length, 0);
    expect(inGrids).toBe((html.match(fields) ?? []).length);
    expect(inGrids).toBeGreaterThan(8);
    expect(html).not.toMatch(/\b(w|min-w)-\[\d|style="[^"]*width/);
    for (const [tag] of html.matchAll(/<p[^>]*>/g)) expect(tag).toMatch(/wrap-anywhere/);
  });

  it("offers Add to bench only with the side's roster and a way to add, and states the cap while more are left", () => {
    const { doubles, rosters } = busy();
    const without = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles, issues: null, apply: () => undefined } }, createElement(BenchFields, { id: "b", side: "own" })));
    expect(without).not.toMatch(/data-doubles-bench-add/);
    expect(without).toMatch(/data-doubles-bench-row="own-2"/);
    const sv = runtimes[SV];
    const full = benched(doubles, "own", entryOf(sv, "own", 5, "snorlax"));
    const html = renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles: full, issues: null, apply: () => undefined, rosters, update: () => undefined } }, createElement(BenchFields, { id: "b", side: "own" })));
    expect(html).not.toMatch(/data-doubles-bench-add/);
    expect(text(html)).toContain("A bench holds at most four Pokémon.");
    // Without anything to show: nothing.
    expect(renderToStaticMarkup(createElement(EarlierTurnContext.Provider, { value: { doubles: matchup(sv), issues: null, apply: () => undefined } }, createElement(BenchFields, { id: "b", side: "own" })))).toBe("");
    expect(renderToStaticMarkup(createElement(BenchFields, { id: "b", side: "own" }))).toBe("");
  });

  it("applies each row's Remove and adds through the whole state", () => {
    const { doubles, rosters } = busy();
    const applied: EarlierChange[] = [];
    const updates: ((state: CalculatorState) => CalculatorState)[] = [];
    const view = benchSideView(doubles, "own", rosters.own);
    expect(view.rows.map((row) => row.name)).toEqual(["Snorlax (yours, 2)", speciesName(runtimes[SV], holder(runtimes[SV], "intrepidsword")!), "Snorlax (yours, 3)"]);
    expect(view.rows[2].remove(doubles).bench.own.map((entry) => entry.key)).toEqual(["test:own:0", "test:own:1"]);
    // The pick of the removed Pokémon goes with it.
    expect(view.rows[2].remove(doubles).bench.picks).toEqual({});
    page({ doubles, issues: null, apply: (change) => applied.push(change), rosters, update: (transition) => updates.push(transition) });
    expect([applied, updates]).toEqual([[], []]);
  });
});

// ---------- the switches on the cards and in the turn ----------

const hp = (start: number, maximum: number, low: number, average: number, high: number, min: number, max: number, koChance = 0): DoublesHP => ({ start, maximum, low, average, high, min, max, koChance, heals: [] });
const BENCH_NAMES = { corviknight: "Corviknight", snorlax: "Snorlax (opponent's)" };

/** Charizard U-turns out (into Corviknight, half the turn into Snorlax by a Roar), then Corviknight takes a hit and the sandstorm; Venusaur's Eject Pack at the end. */
function switchTurn(endReady = true): Extract<DoublesTurnResult, { status: "ready" }> {
  const row: MoveDamageResult = { moveId: "earthquake", kind: "calculated", min: 30, max: 36, minPercent: 15, maxPercent: 18, rolls: null, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1 };
  return {
    status: "ready",
    start: { "own-left": { hp: 153, maximum: 153 }, "own-right": { hp: 155, maximum: 155 }, "opponent-left": { hp: 154, maximum: 154 }, "opponent-right": { hp: 110, maximum: 110 } },
    steps: [{
      slot: "opponent-left", moveId: "earthquake", order: [{ position: 1, chance: 1 }], moves: 1, skipped: [], facts: [],
      hits: [
        { slot: "own-left", id: "corviknight", reached: 0.5, kind: "calculated", min: 30, max: 36, minPercent: 15, maxPercent: 18, koChance: 0.5, row, cases: 1, facts: [] },
        { slot: "own-left", reached: 0.5, kind: "calculated", min: 40, max: 48, minPercent: 26, maxPercent: 31, koChance: 0, row, cases: 1, facts: [] },
      ],
    }],
    hp: {
      "own-left": hp(153, 153, 120, 125, 130, 98, 130), "own-right": hp(155, 155, 155, 155, 155, 155, 155),
      "opponent-left": hp(154, 154, 154, 154, 154, 154, 154), "opponent-right": hp(110, 110, 110, 110, 110, 110, 110),
    },
    startRows: [], facts: ["Assumes Corviknight comes in for Charizard."],
    replaced: { "own-left": { left: [{ id: startId("own-left"), hp: hp(153, 153, 120, 125, 130, 98, 130), chance: 1 }], entered: [{ id: "corviknight", chance: 0.5 }, { id: "snorlax", chance: 0.5 }] } },
    hpEntered: { "own-left": { corviknight: hp(190, 190, 154, 157, 160, 0, 160, 0.5), snorlax: hp(220, 220, 220, 220, 220, 220, 220) } },
    endOfTurn: endReady ? {
      status: "ready", facts: [],
      hp: { "own-left": hp(153, 153, 120, 125, 130, 98, 130), "own-right": hp(155, 155, 140, 140, 140, 140, 140), "opponent-left": hp(154, 154, 154, 154, 154, 154, 154), "opponent-right": hp(110, 110, 110, 110, 110, 110, 110) },
      residuals: [{ slot: "own-left", id: "snorlax", effect: "Sandstorm", chance: 0.5, min: -13, max: -13, koChance: 0, facts: [] }],
      hpEntered: { "own-left": { corviknight: hp(190, 190, 154, 157, 160, 0, 160, 0.5), snorlax: hp(220, 220, 207, 207, 207, 207, 207) }, "own-right": { garchomp: hp(183, 183, 183, 183, 183, 183, 183) } },
      replaced: { "own-right": { left: [{ id: startId("own-right"), hp: hp(155, 155, 140, 140, 140, 140, 140), chance: 1 }], entered: [{ id: "garchomp", chance: 1 }] } },
    } : { status: "not-estimated", reason: "Too many cases to follow." },
  };
}

describe("the switches on the cards and in the turn (SPEC2 §5.2, F4 §5.4)", () => {
  const names = { "own-left": "Charizard", "own-right": "Venusaur", "opponent-left": "Blastoise", "opponent-right": "Pikachu" } as const;
  const benchNames = { ...BENCH_NAMES, garchomp: "Garchomp" };

  it("names a newcomer by its bench name, and a slot's starting Pokémon by its own", () => {
    expect(idName(names, benchNames, "own-left")).toBe("Charizard");
    expect(idName(names, benchNames, "own-left", startId("own-left"))).toBe("Charizard");
    expect(idName(names, benchNames, "own-left", startId("own-right"))).toBe("Venusaur");
    expect(idName(names, benchNames, "own-left", "corviknight")).toBe("Corviknight");
    expect(namesFor(names, benchNames, "own-left")).toBe(names);
    expect(namesFor(names, benchNames, "own-left", "snorlax")).toEqual({ ...names, "own-left": "Snorlax (opponent's)" });
    const turn = switchTurn();
    expect(recordOf(turn.hp, turn.hpEntered, "own-left", "corviknight")).toBe(turn.hpEntered!["own-left"]!.corviknight);
    expect(recordOf(turn.hp, turn.hpEntered, "own-left")).toBe(turn.hp["own-left"]);
  });

  it("gives each slot's leavers and newcomers, the moves' and the end of turn's, with the newcomers' HP after the turn", () => {
    const turn = switchTurn();
    expect(slotSwitches(turn, "opponent-left", names, benchNames)).toBeNull();
    const left = slotSwitches(turn, "own-left", names, benchNames)!;
    expect(left.left.map(leaverText)).toEqual(["Charizard switches out at 98–130 HP."]);
    expect(left.entered.map((entry) => [entry.name, entry.chance, entry.hp?.average])).toEqual([["Corviknight", 0.5, 157], ["Snorlax (opponent's)", 0.5, 207]]);
    const right = slotSwitches(turn, "own-right", names, benchNames)!;
    expect(right.left.map(leaverText)).toEqual(["Venusaur switches out at 140 HP."]);
    expect(right.entered).toEqual([{ id: "garchomp", name: "Garchomp", chance: 1, hp: turn.endOfTurn.status === "ready" ? turn.endOfTurn.hpEntered!["own-right"]!.garchomp : null }]);
    // With the end of turn not estimated: the moves' switches, the newcomers' HP after the moves.
    const moves = slotSwitches(switchTurn(false), "own-left", names, benchNames)!;
    expect(moves.entered.map((entry) => entry.hp?.average)).toEqual([157, 220]);
    expect(slotSwitches(switchTurn(false), "own-right", names, benchNames)).toBeNull();
  });

  it("shows the leaver's line and each newcomer's HP on its card, names the newcomer in the turn, and reads it in the live summary", () => {
    const turn = switchTurn();
    const cards = {} as Record<DoublesSlotId, DoublesCardView>;
    for (const slot of DOUBLES_SLOTS) {
      cards[slot] = {
        id: slot, slot: combatant(slot), action: { moveId: null, target: null }, rule: null, hp: turn.endOfTurn.status === "ready" ? turn.endOfTurn.hp[slot] : null, afterTurn: true, reached: true,
        issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null, switches: slotSwitches(turn, slot, names, benchNames),
      };
    }
    cards["opponent-left"] = { ...cards["opponent-left"], action: { moveId: "earthquake", target: null }, rule: { kind: "auto", hits: ["own-left", "own-right", "opponent-right"] } };
    const html = renderToStaticMarkup(createElement(DoublesSummary, {
      runtime: championsRuntime, cards, names, benchNames, turn, rollMode: "average", onRollModeChange: vi.fn(), replacement: null, movesControl: "moves", magicRoom: false, terrain: "",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(), onActivateMove: vi.fn(), onChooseMove: vi.fn(),
      onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
    }));
    const card = html.slice(html.indexOf('data-doubles-slot="own-left"'), html.indexOf('data-doubles-slot="own-right"'));
    expect(text(card)).toContain("Charizard switches out at 98–130 HP.");
    expect(text(card)).toContain("Corviknight comes in (50%).");
    expect(text(card)).toContain("Snorlax (opponent's) comes in (50%).");
    expect(text(card)).toContain("After the turn · Average estimate");
    expect(text(card)).toContain("157 / 190 HP");
    expect(text(card)).toContain("Turn start: 190 / 190 · KO chance: 50%");
    expect(card).toMatch(/role="meter" aria-label="Corviknight projected HP in place of Charizard"/);
    expect(card).toMatch(/class="[^"]*wrap-anywhere[^"]*">Charizard switches out/);
    const panel = html.slice(html.indexOf("<section data-doubles-turn"));
    // The hit on Corviknight names it; the hit on Charizard (the other half) names Charizard.
    expect(text(panel)).toContain("Corviknight: 30–36 damage");
    expect(text(panel)).toContain("Charizard: 40–48 damage");
    expect(text(panel)).toContain("Sandstorm · Snorlax (opponent's): −13 HP (50%)");
    expect(text(panel)).toContain("Venusaur switches out at 140 HP.");
    expect(text(panel)).toContain("Garchomp comes in.");
    expect(panel).toMatch(/aria-label="Switches after the turn"/);
    const live = text(html.match(/<p data-doubles-live[^>]*>([\s\S]*?)<\/p>/)![1]);
    expect(live).toContain("Charizard HP remaining: 125 / 153. Charizard switches out at 98–130 HP. Corviknight comes in (50%). Corviknight HP remaining: 157 / 190, KO chance 50%.");
    expect(live).toContain("Venusaur switches out at 140 HP. Garchomp comes in. Garchomp HP remaining: 183 / 183.");
    expect(positionalIn(html)).toEqual([]);
    // The cards' meters, the newcomers' included, have names of their own (the closed choosers' dialogs repeat theirs on every card).
    const meters = [...html.matchAll(/role="meter" aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(meters).toContain("Snorlax (opponent&#x27;s) projected HP in place of Charizard");
    expect(meters.filter((label, index) => meters.indexOf(label) !== index)).toEqual([]);
  });

  it("names a newcomer's own step, the newcomer a later move reached, and a newcomer at a seeder's or holder's place", () => {
    const turn = switchTurn();
    const copy: DoublesStep = {
      slot: "own-left", id: "corviknight", moveId: "swordsdance", copied: "Dancer", order: [{ position: 2, chance: 0.5 }], moves: 0.5, skipped: [],
      facts: [{ text: "Dancer: Corviknight copies Swords Dance.", chance: 0.5 }], hits: [],
    };
    // A newcomer's Dancer copy: its heading names it, not the Pokémon that left (DoublesStep.id).
    expect(stepHeading(2, copy, stepNames(names, benchNames, copy), championsRuntime, { arrow: false, text: "Targets itself" })).toBe("2 · Swords Dance · Corviknight · Targets itself");
    // A later move whose every hit at its target reached one newcomer names it; hits on different Pokémon keep the slot's starting one.
    const onCorv: DoublesStep = { ...turn.steps[0], hits: [turn.steps[0].hits[0]] };
    const rule = { kind: "choose" as const, options: ["own-left", "own-right"] as DoublesSlotId[] };
    expect(actionTargets(stepNames(names, benchNames, onCorv), "opponent-left", rule, "own-left").text).toBe("Corviknight");
    expect(actionTargets(stepNames(names, benchNames, turn.steps[0]), "opponent-left", rule, "own-left").text).toBe("Charizard");
    // Leech Seed's heal goes to the Pokémon at the seeder's place (DoublesResidual.otherId); null: a different one over the outcomes.
    const seed = { slot: "opponent-right" as const, effect: "Leech Seed", other: "own-left" as const, chance: 1, min: -13, max: -13, koChance: 0, facts: [] };
    expect(residualLine({ ...seed, otherId: "corviknight" }, names, false, benchNames)).toBe("Leech Seed · Pikachu: −13 HP (from Corviknight)");
    expect(residualLine({ ...seed, otherId: null }, names, false, benchNames)).toBe("Leech Seed · Pikachu: −13 HP");
    expect(residualLine(seed, names, false, benchNames)).toBe("Leech Seed · Pikachu: −13 HP (from Charizard)");
    expect(residualLine({ ...seed, slot: "own-left", id: "snorlax", other: "opponent-right" }, names, false, benchNames)).toBe("Leech Seed · Snorlax (opponent's): −13 HP (from Pikachu)");
    // On the page: the copy's heading, its hits' list and no Show move for a Pokémon with no card.
    const cards = {} as Record<DoublesSlotId, DoublesCardView>;
    for (const slot of DOUBLES_SLOTS) {
      cards[slot] = {
        id: slot, slot: combatant(slot), action: { moveId: null, target: null }, rule: null, hp: null, afterTurn: true, reached: true,
        issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null, switches: null,
      };
    }
    const hit = { ...turn.steps[0].hits[0], slot: "opponent-left" as const, id: undefined };
    const dancing: DoublesTurnResult = { ...turn, steps: [...turn.steps, { ...copy, moveId: "dragondance", hits: [{ ...hit, kind: "effect", min: null, max: null, minPercent: null, maxPercent: null }] }] };
    const html = renderToStaticMarkup(createElement(DoublesSummary, {
      runtime: championsRuntime, cards, names, benchNames, turn: dancing, rollMode: "average", onRollModeChange: vi.fn(), replacement: null, movesControl: "moves", magicRoom: false, terrain: "",
      onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(), onActivateMove: vi.fn(), onChooseMove: vi.fn(),
      onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
    }));
    const step = html.slice(html.indexOf('data-doubles-copied="Dancer"'));
    expect(text(step)).toContain("2 · Dragon Dance · Corviknight · Targets itself");
    expect(step).toMatch(/aria-label="Dragon Dance hits from Corviknight"/);
    expect(text(step)).not.toContain("Show move");
    expect(positionalIn(html)).toEqual([]);
  });

  it("lists each newcomer's losses as it came in (its hazards) in the turn, during the moves and after the residual (integration 2)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const build = (species: string, abilityId: string, itemId = ""): BattleBuild => ({ ...createBuild(species, sv), abilityId, abilityActive: true, itemId, nature: "Serious" }) as BattleBuild;
    const entry = (b: BattleBuild, moveId: string | null, target: DoublesSlotId | null = null) => ({ build: b, contexts: {}, charged: false, action: { moveId, target } });
    const render = (input: Parameters<typeof calculateDoublesTurn>[0]) => {
      const turn = calculateDoublesTurn(input);
      if (turn.status !== "ready") throw new Error(`expected ready, got ${turn.status}`);
      const turnNames = doublesNames(input.pokemon, sv), bench = turnBenchNames(input);
      const cards = {} as Record<DoublesSlotId, DoublesCardView>;
      for (const slot of DOUBLES_SLOTS) {
        const pokemon = input.pokemon[slot]!;
        cards[slot] = {
          id: slot, slot: { ...combatant(slot), build: pokemon.build }, action: pokemon.action, rule: null, hp: turn.hp[slot], afterTurn: false, reached: true,
          issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null, switches: slotSwitches(turn, slot, turnNames, bench),
        };
      }
      const html = renderToStaticMarkup(createElement(DoublesSummary, {
        runtime: sv, cards, names: turnNames, benchNames: bench, turn, rollMode: "average", onRollModeChange: vi.fn(), replacement: null, movesControl: "moves", magicRoom: false, terrain: "",
        onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(), onActivateMove: vi.fn(), onChooseMove: vi.fn(),
        onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
      }));
      return html.slice(html.indexOf("<section data-doubles-turn"));
    };
    const base = {
      runtime: sv, field: { ...createConditions(), gameType: "Doubles" as const },
      bench: { own: [{ id: "corv", build: build("corviknight", "pressure") }] }, hazards: { own: { stealthRock: true as const, spikes: 1 as const } },
    };
    // U-turn: Corviknight comes in during the moves and loses 1/8 to Stealth Rock (Flying: no Spikes).
    const moves = render({ ...base, pokemon: {
      "own-left": entry(build("ambipom", "technician"), "uturn", "opponent-left"), "own-right": entry(build("gardevoir", "synchronize"), null),
      "opponent-left": entry(build("snorlax", "thickfat"), "bodyslam", "own-left"), "opponent-right": entry(build("garchomp", "roughskin"), null),
    } });
    expect(moves).toMatch(/data-doubles-loss="own-left"[^>]*>Corviknight loses 21 HP \(Stealth Rock\)\.</);
    // Eject Pack after Syrup Bomb's residual Speed drop: the switch after the turn, Corviknight's loss under its line.
    const end = render({ ...base, pokemon: {
      "own-left": entry(build("snorlax", "thickfat", "ejectpack"), null), "own-right": entry(build("gardevoir", "synchronize"), null),
      "opponent-left": entry(build("dipplin", "supersweetsyrup"), "syrupbomb", "own-left"), "opponent-right": entry(build("garchomp", "roughskin"), null),
    } });
    const after = text(end.slice(end.indexOf('aria-label="Switches after the turn"')));
    expect(after).toContain("Corviknight comes in.");
    expect(after.indexOf("Corviknight loses 21 HP (Stealth Rock).")).toBeGreaterThan(after.indexOf("Corviknight comes in."));
    expect(end).not.toMatch(/data-doubles-loss/);
    expect(positionalIn(moves + end)).toEqual([]);
  });

  it("shows no switch on a card whose turn is not shown, and keeps the live summary of a turn without one as it was", () => {
    const turn = switchTurn();
    const plain = { ...turn, replaced: undefined, hpEntered: undefined, endOfTurn: { ...turn.endOfTurn, replaced: undefined, hpEntered: undefined } } as typeof turn;
    expect(turnSummary(plain, names, "average", benchNames)).toBe(turnSummary(plain, names, "average"));
    expect(turnSummary(plain, names, "average")).not.toMatch(/switches out|comes in/);
    expect(turnSummary(turn, names, "average", benchNames)).toMatch(/Corviknight comes in/);
  });
});
