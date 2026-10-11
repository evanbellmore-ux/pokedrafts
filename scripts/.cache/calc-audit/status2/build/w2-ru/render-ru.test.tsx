// Track R-U: static renders of the 2v2 Field conditions with the Bench, Replacement and Hazards set, and of the summary with
// a turn whose Pokémon switch out (a hand-built result in the R contract's shape: the stub engine makes no switch yet), for
// the 375 px / 1280 px layout check in the Browser pane (no sign-in). Writes to the scratchpad's ru/render folder.
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/w2-ru/render.config.mts
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import styles from "@/app/(app)/calculator/calculator.module.css";
import BattleConditions, { DoublesCarriedContext, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import type { DoublesCardView } from "@/app/(app)/calculator/DoublesCard";
import { EarlierTurnContext } from "@/app/(app)/calculator/EarlierTurnFields";
import { addBenchEntry, benchNamesOf, carriedAbilityOn, carriedOptions, setBenchHazards, setBenchPick, type DoublesBenchEntry } from "@/app/(app)/calculator/doubles-inputs";
import { slotSwitches } from "@/app/(app)/calculator/doubles-format";
import { createDoubles, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import type { RosterChoice, RosterSource } from "@/app/(app)/calculator/roster-prep";
import { DOUBLES_SLOTS, doublesNames, slotSide, startId, type DoublesHP, type DoublesSideId, type DoublesSlotId, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, MoveDamageResult } from "@/app/lib/battle/types";

const OUT = "C:/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad/ru/render";
type Mon = { species: string; move: string | null; target?: DoublesSlotId; item?: string; ability?: string; status?: BattleBuild["status"] };

function source(runtime: BattleRuntime, side: DoublesSideId, index: number, species: string): RosterSource {
  return { kind: "paste", key: `r:${side}:${index}`, name: runtime.speciesById.get(species)!.name, speciesId: species, runtimeIdentity: runtime.identity, role: side, importId: "r", index };
}
function entry(runtime: BattleRuntime, side: DoublesSideId, index: number, species: string, build: Partial<BattleBuild> = {}): DoublesBenchEntry {
  const src = source(runtime, side, index, species);
  return { key: src.key, source: src, base: { ...createBuild(species, runtime), ...build } as BattleBuild, moves: [] };
}
const choice = (src: RosterSource): RosterChoice => ({ key: src.key, name: src.name, speciesId: src.speciesId, source: src, reason: null });
const hp = (start: number, maximum: number, average: number, min: number, max: number, koChance = 0): DoublesHP => ({ start, maximum, low: Math.round(average), average, high: Math.round(average), min, max, koChance, heals: [] });

async function page(name: string, game: BattleGame, mons: Record<DoublesSlotId, Mon>, setup: (d: DoublesMatchup, r: BattleRuntime) => DoublesMatchup, rosters: (r: BattleRuntime) => Record<DoublesSideId, RosterChoice[]>) {
  mkdirSync(OUT, { recursive: true });
  const runtime = await loadBattleRuntime(game);
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots }, actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const m = mons[slot];
    slots[slot] = { ...slots[slot], build: { ...createBuild(m.species, runtime), ...(m.item !== undefined ? { itemId: m.item } : {}), ...(m.ability ? { abilityId: m.ability } : {}), ...(m.status ? { status: m.status } : {}) },
      moves: [m.move, null, null, null].map((moveId) => ({ moveId, origin: "manual", gameType: "Doubles" })) as MoveSlots };
    actions[slot] = { moveId: m.move, target: m.target ?? null };
  }
  const doubles = setup({ ...base, slots, actions }, runtime);
  const names = doublesNames(doubles.slots, runtime);
  const benchNames = benchNamesOf(doubles);
  const [first, second] = doubles.bench.own;
  const row: MoveDamageResult = { moveId: "earthquake", kind: "calculated", min: 30, max: 36, minPercent: 15, maxPercent: 18, rolls: null, ohkoChance: 0, description: "", assumptions: [], reason: null, hits: 1 };
  // A hand-built turn in the R contract's shape: own-left's Pokémon leaves, the first bench Pokémon comes in half the turn and the
  // second the other half; own-right's leaves after the end of turn for the third.
  const turn: Extract<DoublesTurnResult, { status: "ready" }> = {
    status: "ready", start: { "own-left": { hp: 150, maximum: 150 }, "own-right": { hp: 160, maximum: 160 }, "opponent-left": { hp: 154, maximum: 154 }, "opponent-right": { hp: 110, maximum: 110 } },
    steps: [{ slot: "opponent-left", moveId: "earthquake", order: [{ position: 1, chance: 1 }], moves: 1, skipped: [], facts: [{ text: `${names["own-left"]} switches out; ${benchNames[first.key]} comes in.`, chance: 0.5 }],
      hits: [{ slot: "own-left", id: first.key, reached: 0.5, kind: "calculated", min: 30, max: 36, minPercent: 15, maxPercent: 18, koChance: 0.25, row, cases: 1, facts: [] },
        { slot: "own-left", id: second.key, reached: 0.5, kind: "calculated", min: 40, max: 48, minPercent: 26, maxPercent: 31, koChance: 0, row, cases: 1, facts: [] }] }],
    hp: { "own-left": hp(150, 150, 125, 98, 130), "own-right": hp(160, 160, 160, 160, 160), "opponent-left": hp(154, 154, 154, 154, 154), "opponent-right": hp(110, 110, 110, 110, 110) },
    startRows: [], facts: [`Assumes ${benchNames[first.key]} comes in for ${names["own-left"]}.`],
    replaced: { "own-left": { left: [{ id: startId("own-left"), hp: hp(150, 150, 125, 98, 130), chance: 1 }], entered: [{ id: first.key, chance: 0.5 }, { id: second.key, chance: 0.5 }] } },
    hpEntered: { "own-left": { [first.key]: hp(190, 190, 157, 0, 160, 0.25), [second.key]: hp(220, 220, 220, 220, 220) } },
    endOfTurn: {
      status: "ready", facts: [],
      hp: { "own-left": hp(150, 150, 125, 98, 130), "own-right": hp(160, 160, 140, 140, 140), "opponent-left": hp(154, 154, 154, 154, 154), "opponent-right": hp(110, 110, 110, 110, 110) },
      residuals: [{ slot: "own-left", id: second.key, effect: "Sandstorm", chance: 0.5, min: -13, max: -13, koChance: 0, facts: [] }],
      hpEntered: { "own-left": { [first.key]: hp(190, 190, 157, 0, 160, 0.25), [second.key]: hp(220, 220, 207, 207, 207) }, "own-right": { [doubles.bench.own[2].key]: hp(183, 183, 183, 183, 183) } },
      replaced: { "own-right": { left: [{ id: startId("own-right"), hp: hp(160, 160, 140, 140, 140), chance: 1 }], entered: [{ id: doubles.bench.own[2].key, chance: 1 }] } },
    },
  };
  const cards = {} as Record<DoublesSlotId, DoublesCardView>;
  for (const slot of DOUBLES_SLOTS) {
    cards[slot] = { id: slot, slot: doubles.slots[slot], action: doubles.actions[slot], rule: null, hp: turn.endOfTurn.status === "ready" ? turn.endOfTurn.hp[slot] : null, afterTurn: true,
      reached: true, issues: [], mimicry: null, rosterPanel: { status: "empty", teamName: null, message: null, choices: [] }, rosterDisabled: () => null, switches: slotSwitches(turn, slot, names, benchNames) };
  }
  const noop = vi.fn();
  const summary = createElement(DoublesSummary, {
    runtime, cards, names, benchNames, turn, rollMode: "average", onRollModeChange: noop, replacement: null, movesControl: "moves", magicRoom: false, terrain: "",
    onBuildChange: noop, onHPChange: noop, onRosterSelect: noop, onToggleMega: noop, onToggleMechanic: noop, onActivateMove: noop, onChooseMove: noop,
    onSwitchedIn: noop, onShowMoves: noop, onTargetChange: noop, onShowStep: noop, onFixSettings: noop,
  });
  const carried: CarriedControl[] = DOUBLES_SLOTS.map((slot) => ({
    slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], value: doubles.carried[slot],
    options: carriedOptions(doubles.slots[slot].build, runtime, false, carriedAbilityOn(doubles, slot)), onChange: noop,
  }));
  const conditions = createElement(DoublesCarriedContext.Provider, { value: carried },
    createElement(EarlierTurnContext.Provider, { value: { doubles, issues: null, apply: noop, rosters: rosters(runtime), update: noop } },
      createElement(BattleConditions, { runtime, variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" }, value: doubles.field, issues: [], onChange: noop,
        charge: DOUBLES_SLOTS.map((slot) => ({ slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], checked: false, onChange: noop })) })));
  const html = renderToStaticMarkup(createElement(Fragment, null, summary, createElement("div", { className: "mt-4" }, conditions)));
  let css = readFileSync("app/(app)/calculator/calculator.module.css", "utf8");
  const suffix = (styles as Record<string, string>).root.replace(/^_root_/, "");
  css = css.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, plain: string) => `._${plain}_${suffix}`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${name}</title><link rel="stylesheet" href="ru.css"><style>${css} body{margin:0;padding:16px;background:#101012;color:#f5f5f4} main{container:calculator/inline-size}</style></head><body><main id="root">${html}</main></body></html>`;
  writeFileSync(`${OUT}/${name}.html`, doc);
}

it("renders the R-U pages", async () => {
  await page("ru-sv", "scarlet_violet", {
    "own-left": { species: "talonflame", move: "uturn", target: "opponent-left" }, "own-right": { species: "snorlax", move: null, item: "ejectbutton" },
    "opponent-left": { species: "arcanine", move: "roar", target: "own-right" }, "opponent-right": { species: "snorlax", move: null, item: "redcard" },
  }, (d, r) => {
    let next = d;
    for (const e of [entry(r, "own", 0, "snorlax", { status: "slp" }), entry(r, "own", 1, "zacian", { abilityId: "intrepidsword" }), entry(r, "own", 2, "corviknight")]) next = addBenchEntry("own", e, [])(next);
    for (const e of [entry(r, "opponent", 0, "snorlax"), entry(r, "opponent", 1, "gardevoir")]) next = addBenchEntry("opponent", e, [])(next);
    next = setBenchHazards("own", { stealthRock: true, spikes: 2, toxicSpikes: 1, stickyWeb: true })(next);
    next = setBenchHazards("opponent", { spikes: 3 })(next);
    return setBenchPick("own-right", "r:own:2")(next);
  }, (r) => ({ own: [choice(source(r, "own", 3, "garchomp")), choice(source(r, "own", 4, "kingambit"))], opponent: [choice(source(r, "opponent", 2, "gyarados"))] }));
  await page("ru-ch-full", "champions", {
    "own-left": { species: "incineroar", move: "partingshot", target: "opponent-left" }, "own-right": { species: "golisopod", move: null, ability: "emergencyexit" },
    "opponent-left": { species: "garchomp", move: null }, "opponent-right": { species: "gyarados", move: null },
  }, (d, r) => {
    let next = d;
    for (const e of [entry(r, "own", 0, "snorlax", { status: "frz" }), entry(r, "own", 1, "alakazam"), entry(r, "own", 2, "corviknight"), entry(r, "own", 3, "garchomp")]) next = addBenchEntry("own", e, [])(next);
    return next;
  }, (r) => ({ own: [choice(source(r, "own", 5, "kingambit"))], opponent: [] }));
  await page("ru-swsh", "sword_shield", {
    "own-left": { species: "corviknight", move: "uturn", target: "opponent-left" }, "own-right": { species: "snorlax", move: null },
    "opponent-left": { species: "garchomp", move: null }, "opponent-right": { species: "gyarados", move: null },
  }, (d, r) => {
    let next = d;
    for (const e of [entry(r, "own", 0, "snorlax"), entry(r, "own", 1, "alakazam"), entry(r, "own", 2, "garchomp")]) next = addBenchEntry("own", e, [])(next);
    return setBenchHazards("own", { steelsurge: true, stealthRock: true })(next);
  }, () => ({ own: [], opponent: [] }));
});
