// FINAL2 (status2 final gate): a copy of int2/render/render-2.test.tsx writing to the scratchpad's final/render, with two more
// pages for review-fixed UI behaviours (Conversion 2's Last move control on its target, R6-1 / R6-r2-4; the Bench and Replacement
// offered for an instructed U-turn, R6-7) and the setup fields they need (moves, history, field).
// Integration 2 (ADDENDUM2 §8.7 step 3; INTEGRATION-1B §4's layout check, wave 2's turns): static renders of the 2v2 summary
// (the four cards with their switches, the turn panel) and Field conditions with the Bench, Replacement and Hazards controls,
// each from the real engine (getDoublesTurnInput → calculateDoublesTurn, as useDoublesView), for the Playwright check at 375 px
// and 1280 px (check-layout.mjs). Writes {page}.html and facts.txt to RENDER_OUT (default: the session scratchpad's
// int2/render), and asserts on each page: every leaver and newcomer of the turn named by name on its card, no position word
// in the page's text.
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/int2/render/render.config.mts
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import styles from "@/app/(app)/calculator/calculator.module.css";
import BattleConditions, { DoublesCarriedContext, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import type { DoublesCardView } from "@/app/(app)/calculator/DoublesCard";
import { EarlierTurnContext } from "@/app/(app)/calculator/EarlierTurnFields";
import { addBenchEntry, carriedAbilityOn, carriedOptions, setBenchHazards, setBenchPick, type DoublesBenchEntry } from "@/app/(app)/calculator/doubles-inputs";
import { cardReached, slotSwitches, turnHP } from "@/app/(app)/calculator/doubles-format";
import { createDoubles, doublesTurnAction, getDoublesTurnInput, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import type { RosterChoice, RosterSource } from "@/app/(app)/calculator/roster-prep";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, doublesNames, slotSide, turnBenchNames, type DoublesSideId, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame } from "@/app/lib/battle/types";

const OUT = process.env.RENDER_OUT ?? "/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad/final/render";
type Mon = { species: string; move: string | null; target?: DoublesSlotId; item?: string; ability?: string; hp?: number; moves?: string[] };
type Bench = { species: string; ability?: string; item?: string };

function source(runtime: BattleRuntime, side: DoublesSideId, index: number, species: string): RosterSource {
  return { kind: "paste", key: `r:${side}:${index}`, name: runtime.speciesById.get(species)!.name, speciesId: species, runtimeIdentity: runtime.identity, role: side, importId: "r", index };
}
function entry(runtime: BattleRuntime, side: DoublesSideId, index: number, b: Bench): DoublesBenchEntry {
  const src = source(runtime, side, index, b.species);
  const base = createBuild(b.species, runtime);
  return { key: src.key, source: src, base: { ...base, ...(b.ability ? { abilityId: b.ability } : {}), ...(b.item !== undefined ? { itemId: b.item } : {}) } as BattleBuild, moves: [] };
}
const choice = (src: RosterSource): RosterChoice => ({ key: src.key, name: src.name, speciesId: src.speciesId, source: src, reason: null });
// "No Pokémon left to switch in" (the side's checkbox while its bench is empty) is "left" as remaining, not a position.
// FINAL2: "PP left" (remaining PP, as in "Assumes Ambipom's U-turn has PP left.") is not a position either.
const POSITION = /\b((?<!PP )left(?! to switch in)|right|slot|position)s?\b/i;
const facts: string[] = [];

type Setup = { bench?: Partial<Record<DoublesSideId, Bench[]>>; hazards?: Parameters<typeof setBenchHazards>[1] & { side?: DoublesSideId }; pick?: [DoublesSlotId, number];
  history?: Partial<Record<DoublesSlotId, DoublesMatchup["history"][DoublesSlotId]>>; field?: Partial<DoublesMatchup["field"]>; expectText?: string[] };
async function page(name: string, game: BattleGame, mons: Record<DoublesSlotId, Mon>, setup: Setup) {
  mkdirSync(OUT, { recursive: true });
  const runtime = await loadBattleRuntime(game);
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots }, actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const m = mons[slot];
    slots[slot] = { ...slots[slot], build: { ...createBuild(m.species, runtime), ...(m.item !== undefined ? { itemId: m.item } : {}), ...(m.ability ? { abilityId: m.ability } : {}), currentHP: m.hp ?? null } as BattleBuild,
      moves: (m.moves ? [0, 1, 2, 3].map((i) => m.moves![i] ?? null) : [m.move, null, null, null]).map((moveId) => ({ moveId, origin: "manual", gameType: "Doubles" })) as MoveSlots };
    actions[slot] = { moveId: m.move, target: m.target ?? null };
  }
  let doubles: DoublesMatchup = { ...base, slots, actions, history: { ...base.history, ...(setup.history ?? {}) }, field: { ...base.field, ...(setup.field ?? {}) } };
  const added: Record<DoublesSideId, DoublesBenchEntry[]> = { own: [], opponent: [] };
  for (const side of ["own", "opponent"] as const) {
    (setup.bench?.[side] ?? []).forEach((b, index) => { const e = entry(runtime, side, index, b); added[side].push(e); doubles = addBenchEntry(side, e, [])(doubles); });
  }
  if (setup.hazards) { const { side = "own", ...flags } = setup.hazards; doubles = setBenchHazards(side, flags)(doubles); }
  if (setup.pick) { const [slot, index] = setup.pick; doubles = setBenchPick(slot, added[slotSide(slot)][index].key)(doubles); }

  // As useDoublesView: the input, the turn, the names, the bench names (turnBenchNames of the input), the cards.
  const input = getDoublesTurnInput(doubles);
  const turn = calculateDoublesTurn(input);
  const names = doublesNames(doubles.slots, runtime);
  const benchNames = turnBenchNames(input);
  const ready = turn.status === "ready" ? turn : null;
  const shown = ready ? turnHP(ready) : null;
  const cards = {} as Record<DoublesSlotId, DoublesCardView>;
  for (const slot of DOUBLES_SLOTS) {
    const action = doublesTurnAction(input, slot);
    cards[slot] = {
      id: slot, slot: doubles.slots[slot], action, rule: action.moveId ? doublesTargetRule(input, slot, action.moveId) : null,
      hp: shown?.hp[slot] ?? null, afterTurn: !!shown?.afterTurn, reached: cardReached(ready, slot, runtime), fainted: false,
      switchedIn: !!doubles.history[slot].switchedIn, switches: ready ? slotSwitches(ready, slot, names, benchNames) : null,
      issues: [], mimicry: null, rosterPanel: { status: "empty", teamName: null, message: null, choices: [] } as never, rosterDisabled: () => null,
    };
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
  // Each side's roster offers one Pokémon that is neither in play nor on the bench, so Add to bench shows.
  const rosters = { own: [choice(source(runtime, "own", 9, "kingambit"))], opponent: [choice(source(runtime, "opponent", 9, "gyarados"))] };
  const conditions = createElement(DoublesCarriedContext.Provider, { value: carried },
    createElement(EarlierTurnContext.Provider, { value: { doubles, issues: turn.status === "issues" ? turn.issues : null, apply: noop, rosters, update: noop } },
      createElement(BattleConditions, { runtime, variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" }, value: doubles.field, issues: [], onChange: noop,
        charge: DOUBLES_SLOTS.map((slot) => ({ slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], checked: false, onChange: noop })) })));
  const html = renderToStaticMarkup(createElement(Fragment, null, summary, createElement("div", { className: "mt-4" }, conditions)));
  let css = readFileSync("app/(app)/calculator/calculator.module.css", "utf8");
  // vitest's stable CSS-module names: _{name}_{hash of the file}; every class selector of the module takes them.
  const suffix = (styles as Record<string, string>).root.replace(/^_root_/, "");
  css = css.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (_, plain: string) => `._${plain}_${suffix}`);
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><link rel="stylesheet" href="globals.out.css"><style>${css} body{margin:0;padding:16px} main{container:calculator/inline-size}</style></head><body class="bg-bg font-sans text-text"><main id="root">${html}</main></body></html>`;
  writeFileSync(`${OUT}/${name}.html`, doc);

  // The engine's facts for the page, and the checks: each leaver and newcomer named by name on its card; no position word.
  const lines: string[] = [`== ${name} (${game}): ${turn.status}${turn.status === "not-estimated" ? ` — ${turn.reason}` : ""}${turn.status === "issues" ? ` ${JSON.stringify(turn.issues)}` : ""}`];
  if (ready) {
    lines.push(...ready.facts.map((f) => `  turn fact: ${f}`));
    for (const step of ready.steps) {
      lines.push(`  step ${names[step.slot]}${step.id ? ` (${benchNames[step.id] ?? step.id})` : ""} ${step.moveId}`);
      lines.push(...step.facts.map((f) => `    fact: ${f.text}${f.chance < 1 ? ` (${f.chance})` : ""}`), ...step.skipped.map((f) => `    skipped: ${f.text}`));
      for (const hit of step.hits) lines.push(`    hit ${hit.id ? benchNames[hit.id] ?? hit.id : names[hit.slot]}: ${hit.kind} ${hit.min ?? ""}–${hit.max ?? ""}${hit.reached < 1 ? ` (reached ${hit.reached})` : ""}${(hit.facts ?? []).map((f) => ` · ${f.text}`).join("")}`);
    }
    const end = ready.endOfTurn;
    if (end.status === "ready") {
      lines.push(...end.facts.map((f) => `  end fact: ${f}`));
      for (const r of end.residuals) lines.push(`  residual ${r.id ? benchNames[r.id] ?? r.id : names[r.slot]}: ${r.effect} ${r.min}..${r.max}`);
    } else lines.push(`  end of turn: ${end.reason}`);
    for (const slot of DOUBLES_SLOTS) {
      const sw = slotSwitches(ready, slot, names, benchNames);
      if (!sw) continue;
      for (const left of sw.left) { lines.push(`  card ${names[slot]}: ${left.name} leaves (${left.chance})`); expect(html).toContain(left.name); }
      for (const came of sw.entered) { lines.push(`  card ${names[slot]}: ${came.name} comes in (${came.chance})${came.hp ? ` ${came.hp.min}–${came.hp.max} HP` : ""}`); expect(html).toContain(`${came.name} comes in`); }
    }
  }
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const positional = text.match(new RegExp(POSITION.source, "gi")) ?? [];
  lines.push(`  position words in the page's text: ${positional.length ? positional.join(", ") : "none"}`);
  facts.push(...lines);
  expect(positional).toEqual([]);
  for (const want of setup.expectText ?? []) { lines.push(`  page text has: ${want}`); expect(text).toContain(want); }
  return { turn, names, benchNames, html, text };
}

it("renders the integration 2 pages", async () => {
  // U-turn with a chosen replacement (the second bench Pokémon, not the default first).
  await page("uturn-chosen", "scarlet_violet", {
    "own-left": { species: "ambipom", move: "uturn", target: "opponent-left" }, "own-right": { species: "gardevoir", move: "moonblast", target: "opponent-right" },
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-left" }, "opponent-right": { species: "garchomp", move: "dragonclaw", target: "own-right" },
  }, { bench: { own: [{ species: "corviknight" }, { species: "gyarados", ability: "intimidate" }] }, pick: ["own-left", 1] });
  // Parting Shot (Champions): Incineroar's stat drop, then its player's replacement.
  await page("parting-shot", "champions", {
    "own-left": { species: "incineroar", move: "partingshot", target: "opponent-left" }, "own-right": { species: "sinistcha", move: null },
    "opponent-left": { species: "garchomp", move: "dragonclaw", target: "own-right" }, "opponent-right": { species: "kingambit", move: "ironhead", target: "own-left" },
  }, { bench: { own: [{ species: "farigiraf" }, { species: "corviknight" }], opponent: [{ species: "whimsicott" }] } });
  // Eject Button: the holder is hit and leaves; its side's first bench Pokémon comes in.
  await page("eject-button", "scarlet_violet", {
    "own-left": { species: "garchomp", move: "dragonclaw", target: "opponent-left" }, "own-right": { species: "gardevoir", move: "moonblast", target: "opponent-right" },
    "opponent-left": { species: "corviknight", move: "bravebird", target: "own-left", item: "ejectbutton" }, "opponent-right": { species: "snorlax", move: null },
  }, { bench: { opponent: [{ species: "amoonguss" }, { species: "rotomwash" }] } });
  // Red Card: the attacker is dragged out, a random bench Pokémon of its side comes in.
  await page("red-card", "scarlet_violet", {
    "own-left": { species: "garchomp", move: "dragonclaw", target: "opponent-left" }, "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "snorlax", move: null, item: "redcard" }, "opponent-right": { species: "arcanine", move: null },
  }, { bench: { own: [{ species: "corviknight" }, { species: "amoonguss" }] } });
  // Roar: a random drag of one of two bench Pokémon onto Stealth Rock.
  await page("roar", "scarlet_violet", {
    "own-left": { species: "garchomp", move: "dragonclaw", target: "opponent-right" }, "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "arcanine", move: "roar", target: "own-left" }, "opponent-right": { species: "snorlax", move: null },
  }, { bench: { own: [{ species: "corviknight" }, { species: "gyarados", ability: "intimidate" }] }, hazards: { side: "own", stealthRock: true } });
  // Emergency Exit (Champions): Golisopod drops below half and leaves.
  await page("emergency-exit", "champions", {
    "own-left": { species: "golisopod", move: null, ability: "emergencyexit" }, "own-right": { species: "sinistcha", move: null },
    "opponent-left": { species: "garchomp", move: "dragonclaw", target: "own-left" }, "opponent-right": { species: "kingambit", move: "kowtowcleave", target: "own-left" },
  }, { bench: { own: [{ species: "farigiraf" }, { species: "corviknight" }] } });
  // Hazards on entry: Stealth Rock and two layers of Spikes under a U-turn's newcomer.
  await page("hazards-entry", "scarlet_violet", {
    "own-left": { species: "ambipom", move: "uturn", target: "opponent-left" }, "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-left" }, "opponent-right": { species: "garchomp", move: null },
  }, { bench: { own: [{ species: "charizard" }, { species: "corviknight" }] }, hazards: { side: "own", stealthRock: true, spikes: 2 } });
  // A Neutralizing Gas newcomer: Weezing-Galar comes in after a U-turn (kept: REASONS.entersWithGas).
  await page("gas-newcomer", "scarlet_violet", {
    "own-left": { species: "ambipom", move: "uturn", target: "opponent-left" }, "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-left" }, "opponent-right": { species: "garchomp", move: null },
  }, { bench: { own: [{ species: "weezinggalar", ability: "neutralizinggas" }] } });
  // A newcomer under Neutralizing Gas (the gas holder in play): the newcomer's Intimidate does not start.
  await page("under-gas-newcomer", "scarlet_violet", {
    "own-left": { species: "ambipom", move: "uturn", target: "opponent-left" }, "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "weezinggalar", move: null, ability: "neutralizinggas" }, "opponent-right": { species: "garchomp", move: "dragonclaw", target: "own-left" },
  }, { bench: { own: [{ species: "gyarados", ability: "intimidate" }] } });
  // FINAL2: Conversion 2 (review 2 R6-1, R6-r2-4): its Last move control is on the target (Snorlax), not on the user (Porygon2).
  const conv = await page("conversion2-target", "scarlet_violet", {
    "own-left": { species: "porygon2", move: "conversion2", target: "opponent-left", ability: "download", moves: ["conversion2", "triattack"] },
    "own-right": { species: "gardevoir", move: null },
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-left", ability: "thickfat", moves: ["bodyslam"] },
    "opponent-right": { species: "garchomp", move: null },
  }, { history: { "opponent-left": { lastMove: "bodyslam", lastMoveTarget: "own-left" } } });
  // The Last move selects by their label's Pokémon name (the label's sr-only part): on every Pokémon but Conversion 2's user.
  const lastMoveOn = [...conv.html.matchAll(/-lastMove" class="[^"]*">Last move<span class="sr-only">: ([^<]+)<\/span>/g)].map((m) => m[1]);
  facts.push(`  conversion2-target: Last move control on: ${lastMoveOn.join(", ")}`);
  expect(lastMoveOn).toContain("Snorlax");
  expect(lastMoveOn).not.toContain("Porygon2");
  // FINAL2: an instructed U-turn (review 2 R6-7): Ambipom's Last move is U-turn and Oranguru instructs it; the Bench and the
  // Replacement show for Ambipom's side, and Corviknight comes in.
  await page("instructed-uturn", "scarlet_violet", {
    "own-left": { species: "oranguru", move: "instruct", target: "own-right" },
    "own-right": { species: "ambipom", move: "doublehit", target: "opponent-left", ability: "technician", moves: ["uturn", "doublehit"] },
    "opponent-left": { species: "snorlax", move: "bodyslam", target: "own-right", ability: "thickfat" },
    "opponent-right": { species: "garchomp", move: null },
  }, { history: { "own-right": { lastMove: "uturn", lastMoveTarget: "opponent-left" } }, field: { trickRoom: true }, bench: { own: [{ species: "corviknight" }] }, pick: ["own-right", 0],
    expectText: ["Bench : your side", "Replacement : Ambipom", "Ambipom switches out; Corviknight comes in."] });
  writeFileSync(`${OUT}/facts.txt`, facts.join("\n") + "\n");
}, 180_000);
