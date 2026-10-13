// Integration 1b: a static render of the 2v2 page's summary (four cards, the turn) and its Field conditions for wave 1b's
// families, for the 375 px / 1280 px layout check in the Browser pane (no sign-in; ADDENDUM2 §8.6's live-check additions):
// Dancer copying Swords Dance, Instruct, a Fire + Grass Pledge, a Future Sight landing from a Pokémon of the turn and from a
// build, Cud Chew's Berry, Trace with two candidates (start rows per variant), a Bide release.
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/int1b/render.config.mts
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import styles from "@/app/(app)/calculator/calculator.module.css";
import BattleConditions, { DoublesCarriedContext, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import { EarlierTurnContext } from "@/app/(app)/calculator/EarlierTurnFields";
import { carriedAbilityOn, carriedOptions } from "@/app/(app)/calculator/doubles-inputs";
import { createDoubles, getDoublesTurnInput, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { getRosterPanel } from "@/app/(app)/calculator/roster-prep";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, doublesNames, slotSide, type DoublesCarried, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleGame } from "@/app/lib/battle/types";

const OUT = "C:/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad/int1b/render";
type Mon = { species: string; move: string | null; target?: DoublesSlotId; item?: string; hp?: number; ability?: string; moves?: string[] };
const lines: string[] = [];

async function page(name: string, game: BattleGame, mons: Record<DoublesSlotId, Mon>, setup: (d: DoublesMatchup, g: BattleGame) => Promise<DoublesMatchup> | DoublesMatchup = (d) => d) {
  mkdirSync(OUT, { recursive: true });
  const runtime = await loadBattleRuntime(game);
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots }, actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const m = mons[slot];
    const fresh = createBuild(m.species, runtime);
    slots[slot] = { ...slots[slot], build: { ...fresh, ...(m.item !== undefined ? { itemId: m.item } : {}), ...(m.ability ? { abilityId: m.ability } : {}), currentHP: m.hp ?? null },
      moves: [m.move, ...(m.moves ?? []), null, null, null].slice(0, 4).map((moveId) => ({ moveId, origin: "manual", gameType: "Doubles" })) as MoveSlots };
    actions[slot] = { moveId: m.move, target: m.target ?? null };
  }
  const doubles = await setup({ ...base, slots, actions }, game);
  const input = getDoublesTurnInput(doubles);
  const turn = calculateDoublesTurn(input);
  const names = doublesNames(doubles.slots, runtime);
  const panel = getRosterPanel(createRosterState(), "own", runtime);
  const cards = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const action = input.pokemon[slot]?.action ?? { moveId: null, target: null };
    return [slot, {
      id: slot, slot: doubles.slots[slot], action, rule: action.moveId ? doublesTargetRule(input, slot, action.moveId) : null,
      hp: turn.status === "ready" ? (turn.endOfTurn.status === "ready" ? turn.endOfTurn.hp[slot] : turn.hp[slot]) ?? null : null,
      afterTurn: turn.status === "ready" && turn.endOfTurn.status === "ready", reached: true, fainted: false, issues: [], mimicry: null,
      rosterPanel: panel, rosterDisabled: () => null, switchedIn: !!doubles.history[slot].switchedIn,
    }];
  })) as never;
  const noop = vi.fn();
  const summary = createElement(DoublesSummary, {
    runtime, cards, names, turn, rollMode: "average", onRollModeChange: noop, replacement: null, movesControl: "moves", magicRoom: false, terrain: "",
    onBuildChange: noop, onHPChange: noop, onRosterSelect: noop, onToggleMega: noop, onToggleMechanic: noop, onActivateMove: noop, onChooseMove: noop,
    onSwitchedIn: noop, onShowMoves: noop, onTargetChange: noop, onShowStep: noop, onFixSettings: noop,
  });
  const carried: CarriedControl[] = DOUBLES_SLOTS.map((slot) => ({
    slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], value: doubles.carried[slot],
    options: carriedOptions(doubles.slots[slot].build, runtime, false, carriedAbilityOn(doubles, slot)), onChange: noop,
  }));
  const conditions = createElement(DoublesCarriedContext.Provider, { value: carried },
    createElement(EarlierTurnContext.Provider, { value: { doubles, issues: turn.status === "issues" ? turn.issues : null, apply: noop } },
      createElement(BattleConditions, { runtime, variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" }, value: doubles.field, issues: [], onChange: noop,
        charge: DOUBLES_SLOTS.map((slot) => ({ slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], checked: false, onChange: noop })) })));
  const html = renderToStaticMarkup(createElement(Fragment, null, summary, createElement("div", { className: "mt-4" }, conditions)));
  let css = readFileSync("app/(app)/calculator/calculator.module.css", "utf8");
  // vitest's stable CSS-module names: _{name}_{hash of the file}; every class selector of the module takes them.
  const suffix = (styles as Record<string, string>).root.replace(/^_root_/, "");
  css = css.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, plain: string) => `._${plain}_${suffix}`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${name}</title><link rel="stylesheet" href="globals.out.css"><style>${css} body{margin:0;padding:16px;background:#101012;color:#f5f5f4} main{container:calculator/inline-size}</style></head><body><main id="root" class="${styles.center ?? ""}">${html}</main></body></html>`;
  writeFileSync(`${OUT}/${name}.html`, doc);
  const facts = turn.status === "ready"
    ? [...turn.facts, ...turn.steps.flatMap((s) => [`[step ${s.slot}${s.copied ? ` ${s.copied}` : ""} ${s.moveId}]`, ...s.facts.map((f) => f.text), ...s.skipped.map((f) => `skip: ${f.text}`), ...s.hits.flatMap((h) => [`hit ${h.slot} ${h.kind} ${h.min}-${h.max}`, ...(h.facts ?? []).map((f) => `  ${f.text}`)])]),
      ...(turn.endOfTurn.status === "ready" ? [...turn.endOfTurn.facts, ...turn.endOfTurn.residuals.map((r) => `residual ${r.slot} ${r.effect} ${r.min}..${r.max} ${(r.facts ?? []).map((f) => f.text).join(" | ")}`)] : [`end: ${turn.endOfTurn.reason}`]),
      ...turn.startRows.map((row) => `start row ${row.slot}>${row.target} ${row.row.moveId} ${row.row.min}-${row.row.max}${row.fact ? ` (${row.fact})` : ""}`)]
    : [turn.status === "not-estimated" ? turn.reason : JSON.stringify(turn.issues)];
  lines.push(`${name}: ${turn.status}\n  ${facts.join("\n  ")}`);
}
const none = (species: string): Mon => ({ species, move: null });
const carry = (d: DoublesMatchup, slot: DoublesSlotId, c: DoublesCarried) => ({ ...d, carried: { ...d.carried, [slot]: { ...d.carried[slot], ...c } } });

it("writes wave 1b's 2v2 pages", async () => {
  // Dancer: Oricorio copies Garchomp's Swords Dance.
  await page("dancer-swordsdance", "scarlet_violet", {
    "own-left": { species: "oricorio", move: null, ability: "dancer" }, "own-right": { species: "lucario", move: "aurasphere", target: "opponent-right" },
    "opponent-left": { species: "garchomp", move: "swordsdance" }, "opponent-right": none("snorlax"),
  });
  // Instruct: Oranguru instructs Garchomp, which used Dragon Claw this turn: Dragon Claw again.
  await page("instruct-dragonclaw", "scarlet_violet", {
    "own-left": { species: "oranguru", move: "instruct", target: "own-right" }, "own-right": { species: "garchomp", move: "dragonclaw", target: "opponent-left" },
    "opponent-left": none("snorlax"), "opponent-right": none("blastoise"),
  });
  // Fire Pledge and Grass Pledge from partners: the combined 150-power Fire move and the sea of fire.
  await page("fire-grass-pledge", "scarlet_violet", {
    "own-left": { species: "charizard", move: "firepledge", target: "opponent-left" }, "own-right": { species: "venusaur", move: "grasspledge", target: "opponent-left" },
    "opponent-left": none("snorlax"), "opponent-right": none("blastoise"),
  });
  // Future Sight landing this turn from a Pokémon of the turn (Hatterene, own-left) on the foe across.
  await page("futuresight-from-turn", "scarlet_violet", {
    "own-left": { species: "hatterene", move: null }, "own-right": none("garchomp"),
    "opponent-left": none("snorlax"), "opponent-right": none("blastoise"),
  }, (d) => carry(d, "opponent-left", { futureMove: { move: "futuresight", source: "own-left" } }));
  // Future Sight landing this turn from a Pokémon no longer in battle (its build: a benched Espeon).
  await page("futuresight-from-build", "scarlet_violet", {
    "own-left": none("garchomp"), "own-right": none("incineroar"),
    "opponent-left": none("snorlax"), "opponent-right": none("blastoise"),
  }, async (d, g) => {
    const runtime = await loadBattleRuntime(g);
    return carry(d, "opponent-left", { futureMove: { move: "futuresight", build: createBuild("espeon", runtime) } });
  });
  // Cud Chew: Farigiraf ate a Sitrus Berry last turn and eats it again at the end of this one.
  await page("cudchew-berry", "scarlet_violet", {
    "own-left": { species: "farigiraf", move: null, ability: "cudchew", item: "", hp: 100 }, "own-right": none("garchomp"),
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-left" }, "opponent-right": none("blastoise"),
  }, (d) => carry(d, "own-left", { cudChew: "sitrusberry" }));
  // Trace with two candidates (Levitate, Thick Fat): one start per copy, the start rows per variant (Earthquake and Fire Punch
  // into Gardevoir read the copy).
  await page("trace-two-candidates", "scarlet_violet", {
    "own-left": { species: "gardevoir", move: "moonblast", target: "opponent-right", ability: "trace" }, "own-right": { species: "garchomp", move: "dragonclaw", target: "opponent-right" },
    "opponent-left": { species: "bronzong", move: "earthquake", ability: "levitate" }, "opponent-right": { species: "snorlax", move: "firepunch", target: "own-left", ability: "thickfat" },
  });
  // The same Trace start with a turn not estimated (Incineroar's Parting Shot before the foes move: its replacement is not known), so the summary lists the
  // start rows, each start's with its label.
  await page("trace-start-rows", "scarlet_violet", {
    "own-left": { species: "gardevoir", move: "moonblast", target: "opponent-right", ability: "trace" }, "own-right": { species: "incineroar", move: "partingshot", target: "opponent-right" },
    "opponent-left": { species: "bronzong", move: "earthquake", ability: "levitate" }, "opponent-right": { species: "snorlax", move: "firepunch", target: "own-left", ability: "thickfat" },
  });
  // Bide's release (USUM): 50 HP stored from the foe Snorlax, released at it.
  await page("bide-release", "ultra_sun_ultra_moon", {
    "own-left": { species: "snorlax", move: "bide" }, "own-right": none("garchomp"),
    "opponent-left": none("blastoise"), "opponent-right": none("snorlax"),
  }, (d) => carry(d, "own-left", { bide: { stored: 50, source: "opponent-right", release: true } }));
  writeFileSync(`${OUT}/facts.txt`, lines.join("\n"));
}, 240_000);
