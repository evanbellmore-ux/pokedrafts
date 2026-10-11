// Integration 1a: a static render of the 2v2 page's summary (four cards, the turn) and its Field conditions with the
// earlier-turn controls (EarlierTurnContext, as useDoublesView provides it), for the 375 px / 1280 px layout check in the
// Browser pane (no sign-in). Scenarios: Dig then the ally's Earthquake with a carried Fly charge, Protect with its counter,
// High Jump Kick into Protect, Focus Band on a knockout, Bullet Seed (a multi-hit move) into Mimikyu, Switched in with Payback.
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/int1a/render.config.mts
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import styles from "@/app/(app)/calculator/calculator.module.css";
import BattleConditions, { DoublesCarriedContext, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import { EarlierTurnContext } from "@/app/(app)/calculator/EarlierTurnFields";
import { carriedAbilityOn, carriedOptions, earlierSlotControls, switchDoublesIn } from "@/app/(app)/calculator/doubles-inputs";
import { createDoubles, getDoublesTurnInput, type DoublesMatchup } from "@/app/(app)/calculator/doubles-prep";
import { createRosterState } from "@/app/(app)/calculator/roster-data";
import { getRosterPanel } from "@/app/(app)/calculator/roster-prep";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, doublesNames, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild } from "@/app/lib/battle/model";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import type { BattleGame } from "@/app/lib/battle/types";

const OUT = "C:/Users/evanb/AppData/Local/Temp/claude/C--Users-evanb-OneDrive-pokedrafts/2f5050c3-27de-4325-af6b-e1650dd1d85e/scratchpad/int1a/render";
type Mon = { species: string; move: string | null; target?: DoublesSlotId; item?: string; hp?: number; ability?: string };

async function page(name: string, game: BattleGame, mons: Record<DoublesSlotId, Mon>, setup: (d: DoublesMatchup) => DoublesMatchup = (d) => d) {
  const runtime = await loadBattleRuntime(game);
  const base = createDoubles(0, runtime);
  const slots = { ...base.slots }, actions = { ...base.actions };
  for (const slot of DOUBLES_SLOTS) {
    const m = mons[slot];
    const fresh = createBuild(m.species, runtime);
    slots[slot] = { ...slots[slot], build: { ...fresh, ...(m.item !== undefined ? { itemId: m.item } : {}), ...(m.ability ? { abilityId: m.ability } : {}), currentHP: m.hp ?? null },
      moves: [m.move, null, null, null].map((moveId) => ({ moveId, origin: "manual", gameType: "Doubles" })) as MoveSlots };
    actions[slot] = { moveId: m.move, target: m.target ?? null };
  }
  const doubles = setup({ ...base, slots, actions });
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
  const facts = turn.status === "ready" ? [...turn.facts, ...turn.steps.flatMap((s) => [...s.facts.map((f) => f.text), ...s.skipped.map((f) => f.text), ...s.hits.flatMap((h) => (h.facts ?? []).map((f) => f.text))])] : [turn.status === "not-estimated" ? turn.reason : JSON.stringify(turn.issues)];
  console.log(`${name}: ${turn.status}; ${earlierSlotControls(doubles, "own-left").map((c) => c.key).join(",")}\n  ${facts.join("\n  ")}`);
}

it("writes the 2v2 pages", async () => {
  // Dig, then its ally's Earthquake; a foe's Fly charged last turn (the "Fly charged last turn" control); Protect with its counter.
  await page("dig-eq-fly-protect", "scarlet_violet", {
    "own-left": { species: "garchomp", move: "dig", target: "opponent-right" }, "own-right": { species: "excadrill", move: "earthquake" },
    "opponent-left": { species: "corviknight", move: "fly", target: "own-right" }, "opponent-right": { species: "snorlax", move: "protect" },
  }, (d) => ({ ...d, carried: { ...d.carried, "opponent-left": { charging: "fly" }, "opponent-right": { stall: 3 } } }));
  // High Jump Kick into Protect (the crash), Focus Band on a knockout, Bullet Seed (a multi-hit move) into Mimikyu.
  await page("hjk-band-mimikyu", "scarlet_violet", {
    "own-left": { species: "hitmonlee", move: "highjumpkick", target: "opponent-left" }, "own-right": { species: "breloom", move: "bulletseed", target: "opponent-right" },
    "opponent-left": { species: "snorlax", move: "protect" }, "opponent-right": { species: "mimikyu", move: null, item: "focusband", hp: 10 },
  });
  // Switched in with Payback (Tyranitar's Payback into a Pokémon that switched in this turn: not doubled).
  await page("switched-in-payback", "scarlet_violet", {
    "own-left": { species: "tyranitar", move: "payback", target: "opponent-left" }, "own-right": { species: "venusaur", move: null },
    "opponent-left": { species: "snorlax", move: null }, "opponent-right": { species: "blastoise", move: null },
  }, (d) => switchDoublesIn(d, "opponent-left", true));
}, 120_000);

// SPEC2 §8.4 step 5's list (ADDENDUM2 §8.4 step 4), as static pages: Magic Coat is not in Scarlet/Violet, so its page is USUM's;
// Alcremie gets Sweet Veil (its default here, Aroma Veil, blocks Heal Block: Recover then heals, as pinned Showdown).
const none = (species: string): Mon => ({ species, move: null });
const hist = (d: DoublesMatchup, slot: DoublesSlotId, h: Record<string, unknown>) => ({ ...d, history: { ...d.history, [slot]: { ...d.history[slot], ...h } } });
it("writes SPEC2's live-check pages", async () => {
  await page("skillswap-intimidate", "scarlet_violet", {
    "own-left": { species: "wyrdeer", move: "skillswap", target: "opponent-left", ability: "intimidate" }, "own-right": { species: "gardevoir", move: "moonblast", target: "opponent-right" },
    "opponent-left": { species: "garchomp", move: "dragonclaw", target: "own-right" }, "opponent-right": { species: "incineroar", move: "flareblitz", target: "own-left" },
  });
  await page("soak-thunderbolt", "scarlet_violet", {
    "own-left": { species: "basculegion", move: "soak", target: "opponent-left" }, "own-right": { species: "bellibolt", move: "thunderbolt", target: "opponent-left" },
    "opponent-left": none("garchomp"), "opponent-right": none("snorlax"),
  });
  await page("magiccoat-thunderwave", "ultra_sun_ultra_moon", {
    "own-left": { species: "jolteon", move: "thunderwave", target: "opponent-left" }, "own-right": none("snorlax"),
    "opponent-left": { species: "espeon", move: "magiccoat" }, "opponent-right": none("blastoise"),
  });
  await page("matchagotcha-two-foes", "scarlet_violet", {
    "own-left": { species: "sinistcha", move: "matchagotcha", hp: 120 }, "own-right": none("indeedee"),
    "opponent-left": none("garchomp"), "opponent-right": none("incineroar"),
  });
  await page("sheercold-sturdy", "scarlet_violet", {
    "own-left": { species: "abomasnow", move: "sheercold", target: "opponent-left" }, "own-right": { species: "glalie", move: "sheercold", target: "opponent-right" },
    "opponent-left": { species: "garganacl", move: null, ability: "sturdy" }, "opponent-right": none("snorlax"),
  });
  await page("fling-lifeorb", "scarlet_violet", {
    "own-left": { species: "incineroar", move: "fling", target: "opponent-left", item: "lifeorb" }, "own-right": none("gardevoir"),
    "opponent-left": none("snorlax"), "opponent-right": none("garchomp"),
  });
  await page("shellsmash-opportunist", "scarlet_violet", {
    "own-left": { species: "cloyster", move: "shellsmash" }, "own-right": none("gardevoir"),
    "opponent-left": { species: "espathra", move: null, ability: "opportunist" }, "opponent-right": none("garchomp"),
  });
  await page("stockpile-swallow", "scarlet_violet", {
    "own-left": { species: "clodsire", move: "swallow", hp: 80 }, "own-right": none("gardevoir"),
    "opponent-left": none("snorlax"), "opponent-right": none("garchomp"),
  }, (d) => ({ ...d, carried: { ...d.carried, "own-left": { stockpile: { layers: 2 } } } }));
  await page("encore-lastmove", "scarlet_violet", {
    "own-left": { species: "whimsicott", move: "encore", target: "opponent-left" }, "own-right": none("gardevoir"),
    "opponent-left": { species: "garchomp", move: "earthquake" }, "opponent-right": none("snorlax"),
  }, (d) => hist(d, "opponent-left", { lastMove: "dragonclaw" }));
  await page("recycle-itemused", "scarlet_violet", {
    "own-left": { species: "bronzong", move: "recycle", item: "", hp: 60 }, "own-right": none("gardevoir"),
    "opponent-left": none("snorlax"), "opponent-right": none("garchomp"),
  }, (d) => hist(d, "own-left", { lastItem: "sitrusberry" }));
  // Focus Band on a knockout by a one-hit move (the band's fact is the one-hit move's: W1A-W.md focus-band).
  await page("focusband-ko", "scarlet_violet", {
    "own-left": { species: "garchomp", move: "dragonclaw", target: "opponent-left" }, "own-right": none("gardevoir"),
    "opponent-left": { species: "snorlax", move: null, item: "focusband", hp: 20 }, "opponent-right": none("incineroar"),
  });
  await page("psychicnoise-recover", "scarlet_violet", {
    "own-left": { species: "espeon", move: "psychicnoise", target: "opponent-left" }, "own-right": none("gardevoir"),
    "opponent-left": { species: "alcremie", move: "recover", hp: 80, ability: "sweetveil" }, "opponent-right": none("garchomp"),
  });
}, 180_000);
