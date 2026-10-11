// status-eot integration: a server-render check of the /calculator 2v2 view with the real engine (no browser). Each
// scenario's turn runs through calculateDoublesTurn and renders through DoublesSummary as useDoublesView feeds it (turnHP,
// cardReached); the Field-condition controls render through BattleConditions with the carried controls. The visible text
// goes to build/int-logs/render.txt and is checked for facts only (no instructions, no left/right Pokémon labels).
//   npx vitest run --config scripts/.cache/calc-audit/status-eot/build/int-render.config.mts
import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BattleConditions, { DoublesCarriedContext, type CarriedControl } from "@/app/(app)/calculator/BattleConditions";
import type { DoublesCardView } from "@/app/(app)/calculator/DoublesCard";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import { cardReached, turnHP } from "@/app/(app)/calculator/doubles-format";
import { carriedOptions } from "@/app/(app)/calculator/doubles-prep";
import type { Combatant, RosterPanel } from "@/app/(app)/calculator/roster-prep";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import {
  DOUBLES_SLOTS, doublesNames, slotSide, type DoublesCarried, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput, type DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions as Conditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

const OUT = path.resolve("scripts/.cache/calc-audit/status-eot/build/int-logs/render.txt");
type P = { id: string; ability?: string; item?: string; nature?: string; hp?: number; status?: BattleStatus; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried };
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
const EMPTY_PANEL: RosterPanel = { status: "empty", teamName: null, message: "No roster.", choices: [] };

function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  return { ...base, nature: p.nature ?? base.nature, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", currentHP: p.hp ?? null, status: p.status ?? "" } as BattleBuild;
}
function input(runtime: BattleRuntime, slots: Record<DoublesSlotId, P>, field: Partial<Conditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const p = slots[slot];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, p), contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
/** The cards as useDoublesView builds them for a turn (turnHP, cardReached), and DoublesSummary's markup. */
function render(runtime: BattleRuntime, turnInput: DoublesTurnInput, turn: DoublesTurnResult): string {
  const slots = Object.fromEntries(DOUBLES_SLOTS.map((slot, index) => {
    const combatant: Combatant = {
      key: index, editorRevision: 0, role: slotSide(slot) === "own" ? "own" : "opponent", build: turnInput.pokemon[slot]!.build, hpInput: "", source: null,
      moves: [], megaBase: null, contexts: {}, moveEpoch: 0,
    } as unknown as Combatant;
    return [slot, combatant];
  })) as Record<DoublesSlotId, Combatant>;
  const ready = turn.status === "ready" ? turn : null;
  const shown = ready ? turnHP(ready) : null;
  const cards = Object.fromEntries(DOUBLES_SLOTS.map((slot) => {
    const action = turnInput.pokemon[slot]!.action;
    const view: DoublesCardView = {
      id: slot, slot: slots[slot], action, rule: action.moveId ? doublesTargetRule(turnInput, slot, action.moveId) : null,
      hp: shown?.hp[slot] ?? null, afterTurn: !!shown?.afterTurn, reached: cardReached(ready, slot),
      issues: [], mimicry: null, rosterPanel: EMPTY_PANEL, rosterDisabled: () => null,
    };
    return [slot, view];
  })) as Record<DoublesSlotId, DoublesCardView>;
  const props: ComponentProps<typeof DoublesSummary> = {
    runtime, cards, names: doublesNames(slots, runtime), turn, rollMode: "average", onRollModeChange: vi.fn(), replacement: null, movesControl: "moves-list",
    magicRoom: false, terrain: turnInput.field.terrain,
    onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(), onActivateMove: vi.fn(),
    onChooseMove: vi.fn(), onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
  } as ComponentProps<typeof DoublesSummary>;
  return renderToStaticMarkup(createElement(DoublesSummary, props));
}
/** Text a sighted user sees: no tags, no screen-reader-only text. */
const visible = (html: string) => html.replace(/<(\w+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<(?:li|p|h4|div|section)\b/g, "\n$&")
  .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
const panel = (html: string) => html.slice(html.indexOf("<section data-doubles-turn"));
const cardsOf = (html: string) => html.slice(0, html.indexOf("<section data-doubles-turn"));
const TUTORIAL = /\b(Click|Tap|Choose a|Select a|to see|browse|Enter a|Pick a)\b/;
const POSITIONS = /\b(left|right) Pokémon\b/;
const lines: string[] = [];

async function scenario(name: string, game: BattleGame, slots: Record<DoublesSlotId, P>, field: Partial<Conditions> = {}) {
  const runtime = await loadBattleRuntime(game);
  const turnInput = input(runtime, slots, field);
  const turn = calculateDoublesTurn(turnInput);
  const html = render(runtime, turnInput, turn);
  const turnText = visible(panel(html)), cardText = visible(cardsOf(html));
  lines.push(`==== ${name}: cards`, cardText, "");
  lines.push(`==== ${name} (${game}) — ${turn.status}${turn.status === "not-estimated" ? `: ${turn.reason}` : ""}`, "-- turn panel --", turnText, "-- card HP and conditions --",
    ...[...html.matchAll(/data-doubles-slot="([^"]+)"[\s\S]*?(After the (?:turn|moves) · [^<]+|Current HP)/g)].map((m) => `${m[1]}: ${m[2]}`),
    ...[...html.matchAll(/<p data-doubles-conditions="([^"]+)"[^>]*>([^<]*)<\/p>/g)].map((m) => `${m[1]} conditions: ${m[2].replace(/&#x27;/g, "'")}`), "");
  expect(turnText).not.toMatch(TUTORIAL);
  expect(turnText).not.toMatch(POSITIONS);
  // The Pokémon chooser's dialog names the slot it fills ("Find your left Pokémon", main's PokemonChooser): not a Pokémon label.
  expect(cardText.split("\n").filter((line) => !/^(Change|Find) .+ Pokémon\s*$/.test(line)).join("\n")).not.toMatch(POSITIONS);
  return { turn, html, turnText };
}

describe("status-eot integration: /calculator 2v2 server render", () => {
  it("renders the eight scenarios and the new controls with facts only", async () => {
    try {
    // 1. Thunder Wave then Body Slam into the paralysed Charizard (Champions).
    const twave = await scenario("Thunder Wave + Body Slam", "champions", {
      "own-left": { id: "pikachu", ability: "static", move: "thunderwave", target: "opponent-right" }, "own-right": { id: "snorlax", ability: "thickfat", move: "bodyslam", target: "opponent-right" },
      "opponent-left": idle("garchomp", { ability: "roughskin" }), "opponent-right": idle("charizard"),
    });
    expect(twave.turn.status).toBe("ready");
    expect(twave.turnText).toContain("Is paralysed.");
    expect(twave.html).toMatch(/data-doubles-conditions="opponent-right"[^>]*>Paralysed/);
    // 2. Spore from Amoonguss while Snorlax, asleep for one turn already, uses Body Slam (SV).
    const spore = await scenario("Spore + a carried sleep counter", "scarlet_violet", {
      "own-left": { id: "amoonguss", ability: "regenerator", move: "spore", target: "opponent-right" }, "own-right": idle("venusaur"),
      "opponent-left": { id: "snorlax", ability: "thickfat", status: "slp", carried: { sleep: { attempts: 1, rest: false } }, move: "bodyslam", target: "own-right" },
      "opponent-right": idle("garchomp", { ability: "roughskin" }),
    });
    expect(spore.turn.status).toBe("ready");
    expect(spore.turnText).toMatch(/Wakes up \(33\.33%\)|Asleep \(66\.67%\)/);
    expect(spore.turnText).toContain("Falls asleep.");
    // 3. Sand + Leftovers, with a move and with no move at all (Champions).
    const sand = await scenario("Sand + Leftovers", "champions", {
      "own-left": { id: "tyranitar", ability: "sandstream", move: "rockslide" }, "own-right": idle("snorlax", { ability: "thickfat", item: "leftovers", hp: 150 }),
      "opponent-left": idle("charizard"), "opponent-right": idle("venusaur", { item: "leftovers", hp: 120 }),
    }, { weather: "Sand" });
    expect(sand.turnText).toContain("End of turn");
    expect(sand.turnText).toMatch(/Sandstorm · Snorlax: −\d+ HP/);
    expect(sand.turnText).toMatch(/Leftovers · Snorlax: \+\d+ HP/);
    const sandIdle = await scenario("Sand + Leftovers, no move chosen", "champions", {
      "own-left": idle("tyranitar", { ability: "sandstream" }), "own-right": idle("snorlax", { ability: "thickfat", item: "leftovers", hp: 150 }),
      "opponent-left": idle("charizard"), "opponent-right": idle("venusaur", { item: "leftovers", hp: 120 }),
    }, { weather: "Sand" });
    expect(sandIdle.turnText).not.toContain("No moves chosen.");
    expect(sandIdle.turnText).toMatch(/Leftovers · Venusaur: \+\d+ HP/);
    // 4. Leech Seed this turn (Champions).
    const seed = await scenario("Leech Seed", "champions", {
      "own-left": { id: "venusaur", ability: "overgrow", move: "leechseed", target: "opponent-left" }, "own-right": idle("charizard", { hp: 100 }),
      "opponent-left": idle("garchomp", { ability: "roughskin" }), "opponent-right": idle("blastoise"),
    });
    expect(seed.turnText).toContain("Is seeded.");
    expect(seed.turnText).toMatch(/Leech Seed · Garchomp: −\d+ HP \(from Venusaur\)/);
    // 5. The end-of-turn not-estimated line: Gengar's Skill Swap as the last action under Trick Room (Champions).
    const swap = await scenario("End of turn not estimated", "champions", {
      "own-left": { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "opponent-left" }, "own-right": idle("snorlax", { ability: "thickfat" }),
      "opponent-left": idle("venusaur"), "opponent-right": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "own-right" },
    }, { trickRoom: true });
    expect(swap.turnText).toContain("End of turn not estimated: Skill Swap is not modelled.");
    // 6. Ally Switch, then Azumarill's Aqua Jet aimed at Alakazam's old place hits its partner (Champions).
    const ally = await scenario("Ally Switch + Aqua Jet", "champions", {
      "own-left": { id: "azumarill", ability: "hugepower", move: "aquajet", target: "opponent-left" }, "own-right": idle("snorlax", { ability: "thickfat" }),
      "opponent-left": { id: "alakazam", ability: "magicguard", move: "allyswitch" }, "opponent-right": idle("garchomp", { ability: "roughskin" }),
    });
    expect(ally.turnText).toContain("Ally Switch: Alakazam and Garchomp swap places.");
    expect(ally.turnText).toContain("Ally Switch: Aqua Jet hits Garchomp in Alakazam's place.");
    expect(ally.html).toMatch(/data-doubles-conditions="opponent-left"[^>]*>[^<]*Swapped places with Garchomp/);
    // 7. Trick a Choice Scarf onto Snorlax (50): with it (75) Snorlax now moves before Azumarill (70) (Champions, re-sorted).
    const trick = await scenario("Trick Choice Scarf onto a slower foe", "champions", {
      "own-left": { id: "alakazam", ability: "magicguard", item: "choicescarf", move: "trick", target: "opponent-left" }, "own-right": { id: "azumarill", ability: "hugepower", move: "playrough", target: "opponent-right" },
      "opponent-left": { id: "snorlax", ability: "thickfat", move: "bodyslam", target: "own-right" }, "opponent-right": idle("charizard"),
    });
    expect(trick.turnText).toContain("Trick: Snorlax gets Choice Scarf; Alakazam gets nothing.");
    expect(trick.turnText.indexOf("Body Slam · Snorlax")).toBeLessThan(trick.turnText.indexOf("Play Rough · Azumarill"));
    // 8. A Substitute from an earlier turn, then Cloyster's Icicle Spear (SV).
    const sub = await scenario("Carried Substitute + Icicle Spear", "scarlet_violet", {
      "own-left": { id: "cloyster", ability: "skilllink", move: "iciclespear", target: "opponent-left" }, "own-right": idle("venusaur"),
      "opponent-left": idle("garchomp", { ability: "roughskin", carried: { substitute: 45 } }), "opponent-right": idle("blastoise"),
    });
    expect(sub.turnText).toMatch(/Garchomp's Substitute: −\d+(–\d+)? HP, breaks/);
    expect(sub.turnText).toContain("Icicle Spear hits Garchomp after its Substitute breaks.");

    // The new controls: one block per Pokémon with the build's own counts (Champions: freeze; SV: sleep 0–3).
    for (const [game, statuses] of [["champions", ["slp", "frz", "tox", ""]], ["scarlet_violet", ["slp", "", "tox", ""]]] as const) {
      const runtime = await loadBattleRuntime(game);
      const species = ["garchomp", "snorlax", "charizard", "venusaur"];
      const builds = Object.fromEntries(DOUBLES_SLOTS.map((slot, i) => [slot, { ...createBuild(species[i], runtime), status: statuses[i] } as BattleBuild])) as Record<DoublesSlotId, BattleBuild>;
      const names = doublesNames(Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, { build: builds[slot] }])) as never, runtime);
      const carried: Partial<Record<DoublesSlotId, DoublesCarried>> = { "opponent-right": { confusion: { attempts: 1 }, substitute: 20 } };
      const controls: CarriedControl[] = DOUBLES_SLOTS.map((slot) => ({
        slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], value: carried[slot] ?? {}, issues: undefined,
        options: carriedOptions(builds[slot], runtime, false), onChange: () => undefined,
      }));
      const html = renderToStaticMarkup(createElement(DoublesCarriedContext.Provider, { value: controls },
        createElement(BattleConditions, { value: createConditions(), issues: [], onChange: vi.fn(), variant: "doubles" } as unknown as ComponentProps<typeof BattleConditions>)));
      const blocks = [...html.matchAll(/data-doubles-carried="([^"]+)"/g)].map((m) => m[1]);
      const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => visible(m[1]).replace(/\s+/g, " ")).filter(Boolean);
      const accessible = [...html.matchAll(/class="sr-only">([^<]*)</g)].map((m) => m[1].replace(/&#x27;/g, "'"));
      lines.push(`==== Field-condition controls (${game}; statuses ${statuses.map((s) => s || "none").join(", ")}; opponent-right confused 1, Substitute 20)`,
        `blocks: ${blocks.join(", ")}`, `labels: ${labels.join(" | ")}`, `screen-reader names: ${accessible.join(" | ")}`, "");
      expect(blocks).toEqual([...DOUBLES_SLOTS]);
      expect(visible(html)).not.toMatch(TUTORIAL);
      expect(html).toContain("Turns lost to sleep");
      if (game === "champions") expect(html).toContain("Turns lost to freeze");
      else expect(html).not.toContain("Turns lost to freeze");
      expect(html).toContain("Bad poison turns so far");
      expect(html).toContain("Confusion turns so far");
      expect(html).toContain("Substitute HP");
    }
    } finally {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, lines.join("\n"));
    }
  }, 120_000);
});
