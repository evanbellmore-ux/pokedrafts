import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, NO_ACTION, type DoublesFixture } from "../fixtures/doubles-turn";
import { positionalIn } from "../fixtures/naming";
import DoublesMoves from "@/app/(app)/calculator/DoublesMoves";
import MoveResults from "@/app/(app)/calculator/MoveResults";
import DoublesSummary from "@/app/(app)/calculator/DoublesSummary";
import {
  applyDoublesIntimidate, chooseDoublesMove, createDoubles, doublesBuildIssues, doublesFainted, doublesTurnInput, followShared, focusDoublesMoves,
  getDoublesTurnInput, intimidateFoes, resetDoubles, setDoublesMovesInto, setDoublesTarget, updateDoublesBuild, updateDoublesHP,
  type CalculatorState, type DoublesMatchup,
} from "@/app/(app)/calculator/doubles-prep";
import { actionTargets, FAINTED } from "@/app/(app)/calculator/doubles-format";
import { changeBattleGame, createMatchup, getMoveOwner, updateMatchupHP } from "@/app/(app)/calculator/roster-prep";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { DOUBLES_SLOTS, doublesNames, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, validateBuild } from "@/app/lib/battle/model";
import type { MoveContext, MoveDamageResult } from "@/app/lib/battle/types";
import { championsRuntime } from "@/app/lib/battle/runtime";

// In 2v2, current HP 0 is a Pokémon that fainted before the turn (no replacement left): it does not act, is not a target and
// its slot is empty in the turn's input (doubles-types: null). The target rules are the real ones (doubles-targets.ts).

const state = vi.hoisted(() => ({ doubles: null as DoublesMatchup | null }));
vi.mock("@/app/(app)/leagues/[leagueId]/useMinWidthMd", () => ({ useMinWidthMd: () => false }));
vi.mock("@/app/(app)/calculator/useDesktopRosterLayout", () => ({ useDesktopRosterLayout: () => false }));
vi.mock("@/app/(app)/calculator/useCalculatorRosters", async () => {
  const { createRosterState } = await import("@/app/(app)/calculator/roster-data");
  return { default: () => ({ state: createRosterState(), selectLeague: () => undefined, selectOpponent: () => undefined, refresh: () => undefined }) };
});
vi.mock("@/app/(app)/calculator/doubles-prep", async (original) => {
  const actual = await original<typeof import("@/app/(app)/calculator/doubles-prep")>();
  return { ...actual, createDoubles: (...args: Parameters<typeof actual.createDoubles>) => state.doubles ?? actual.createDoubles(...args) };
});
afterEach(() => { state.doubles = null; });

function start(): CalculatorState {
  return { matchup: createMatchup(), doubles: createDoubles() };
}

const owner = (current: CalculatorState, slot: DoublesSlotId) => getMoveOwner(current.doubles.slots[slot]);
const hp = (current: CalculatorState, slot: DoublesSlotId, text: string) => updateDoublesHP(current, current.doubles.slots[slot].key, text);
const move = (current: CalculatorState, slot: DoublesSlotId, moveId: string | null) => chooseDoublesMove(current, owner(current, slot), moveId);
const target = (current: CalculatorState, slot: DoublesSlotId, aim: DoublesSlotId) => setDoublesTarget(current, owner(current, slot), aim);
const turnActions = (current: CalculatorState) => {
  const input = getDoublesTurnInput(current.doubles);
  return Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, input.pokemon[slot]?.action ?? null]));
};

/** Charizard Rock Slide, Venusaur Sludge Bomb → Blastoise (opponent-left), Pikachu Thunderbolt → Charizard (own-left). */
function prepared() {
  let current = move(start(), "own-left", "rockslide");
  current = move(current, "own-right", "sludgebomb");
  current = move(current, "opponent-right", "thunderbolt");
  return target(current, "opponent-right", "own-left");
}

describe("current HP 0 in 2v2", () => {
  it("is a fainted Pokémon, not an issue; 1v1 still asks for 1 or more", () => {
    const current = hp(start(), "opponent-right", "0");
    const pikachu = current.doubles.slots["opponent-right"];
    expect(pikachu.build.currentHP).toBe(0);
    expect(pikachu.hpInput).toBe("0");
    expect(doublesFainted(current.doubles.slots)).toEqual({ "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": true });
    expect(doublesBuildIssues(pikachu.build, championsRuntime)).toEqual([]);
    // Its other settings are still checked.
    expect(doublesBuildIssues({ ...pikachu.build, boosts: { ...pikachu.build.boosts, atk: 7 } }, championsRuntime).map((issue) => issue.field)).toEqual(["boosts.atk"]);
    expect(doublesBuildIssues(hp(start(), "opponent-right", "-1").doubles.slots["opponent-right"].build, championsRuntime).map((issue) => issue.message))
      .toEqual(["Current HP must be a whole number from 1 to 110."]);
    const oneOnOne = updateMatchupHP(createMatchup(), "defender", "0");
    expect(validateBuild(oneOnOne.defender.build).map((issue) => issue.message)).toEqual(["Current HP must be a whole number from 1 to 154."]);
  });

  it("leaves the slot empty in the turn and keeps its action for when its HP comes back", () => {
    const before = prepared();
    const fainted = hp(before, "opponent-right", "0");
    expect(fainted.doubles.actions).toEqual(before.doubles.actions);
    expect(turnActions(fainted)).toEqual({
      "own-left": { moveId: "rockslide", target: null }, "own-right": { moveId: "sludgebomb", target: "opponent-left" },
      "opponent-left": NO_ACTION, "opponent-right": null,
    });
    const back = hp(fainted, "opponent-right", "");
    expect(back.doubles.actions).toEqual(before.doubles.actions);
    expect(turnActions(back)).toEqual(turnActions(before));
    expect(getDoublesTurnInput(back.doubles).pokemon["opponent-right"]).toMatchObject({ action: { moveId: "thunderbolt", target: "own-left" } });
  });

  it("leaves it out of the other slots' targets: spread moves reach the lone foe and a single foe is picked", () => {
    const current = hp(prepared(), "opponent-right", "0");
    const input = getDoublesTurnInput(current.doubles);
    expect(doublesTargetRule(input, "own-left", "rockslide")).toEqual({ kind: "auto", hits: ["opponent-left"] });
    expect(doublesTargetRule(input, "own-left", "earthquake")).toEqual({ kind: "auto", hits: ["opponent-left", "own-right"] });
    expect(doublesTargetRule(input, "own-right", "sludgebomb")).toEqual({ kind: "choose", options: ["opponent-left", "own-left"] });
    expect(doublesTargetRule(input, "opponent-left", "helpinghand")).toEqual({ kind: "auto", hits: [] });
    // Aiming at the fainted Pokémon is refused.
    expect(target(current, "own-right", "opponent-right")).toBe(current);
  });

  it("aims a move at a fainted foe at the other foe, and the chosen target comes back with that foe's HP", () => {
    const aimed = target(prepared(), "own-right", "opponent-right");
    const fainted = hp(aimed, "opponent-right", "0");
    expect(fainted.doubles.actions["own-right"]).toEqual({ moveId: "sludgebomb", target: "opponent-right" });
    expect(turnActions(fainted)["own-right"]).toEqual({ moveId: "sludgebomb", target: "opponent-left" });
    // A move chosen meanwhile keeps the chosen foe.
    const changed = move(fainted, "own-right", "energyball");
    expect(changed.doubles.actions["own-right"]).toEqual({ moveId: "energyball", target: "opponent-right" });
    expect(turnActions(changed)["own-right"]).toEqual({ moveId: "energyball", target: "opponent-left" });
    expect(turnActions(hp(changed, "opponent-right", "50"))["own-right"]).toEqual({ moveId: "energyball", target: "opponent-right" });
    // Charizard (own-left) fainted: Pikachu's Thunderbolt aimed at it goes to Venusaur (own-right).
    expect(turnActions(hp(prepared(), "own-left", "0"))["opponent-right"]).toEqual({ moveId: "thunderbolt", target: "own-right" });
  });

  it("gives a move at a foe no target once both foes have fainted, never the ally; an ally-or-self move takes itself", () => {
    const aimed = target(move(start(), "own-left", "flamethrower"), "own-left", "own-right");
    let current = hp(hp(start(), "opponent-left", "0"), "opponent-right", "0");
    current = move(current, "own-left", "flamethrower");
    expect(current.doubles.actions["own-left"]).toEqual({ moveId: "flamethrower", target: null });
    expect(turnActions(current)["own-left"]).toEqual({ moveId: "flamethrower", target: null });
    const input = getDoublesTurnInput(current.doubles);
    expect(doublesTargetRule(input, "own-left", "flamethrower")).toEqual({ kind: "choose", options: [] });
    expect(doublesTargetRule(input, "own-left", "earthquake")).toEqual({ kind: "auto", hits: [] });
    expect(target(current, "own-left", "own-right")).toBe(current);
    // Aimed at the ally before both foes fainted: no target either (the battle is over), and the ally again once a foe is back.
    const over = hp(hp(aimed, "opponent-left", "0"), "opponent-right", "0");
    expect(over.doubles.actions["own-left"]).toEqual({ moveId: "flamethrower", target: "own-right" });
    expect(turnActions(over)["own-left"]).toEqual({ moveId: "flamethrower", target: null });
    expect(turnActions(hp(over, "opponent-left", ""))["own-left"]).toEqual({ moveId: "flamethrower", target: "own-right" });
    // Acupressure (adjacentAllyOrSelf) aimed at a fainted ally: itself, as the game offers.
    const base = getDoublesTurnInput(createDoubles());
    const pokemon = { ...base.pokemon } as Record<DoublesSlotId, DoublesPokemonInput>;
    pokemon["own-left"] = { ...pokemon["own-left"], action: { moveId: "acupressure", target: "own-right" } };
    pokemon["own-right"] = { ...pokemon["own-right"], build: { ...pokemon["own-right"].build, currentHP: 0 } };
    expect(doublesTurnInput(championsRuntime, base.field, pokemon).pokemon["own-left"]?.action).toEqual({ moveId: "acupressure", target: "own-left" });
  });

  it("keeps the Moves pane on living Pokémon", () => {
    let current = start();
    expect(current.doubles.moves).toEqual({ slot: "own-left", into: "opponent-left" });
    current = hp(current, "opponent-left", "0");
    expect(current.doubles.moves).toEqual({ slot: "own-left", into: "opponent-right" });
    current = hp(current, "own-left", "0");
    expect(current.doubles.moves).toEqual({ slot: "own-right", into: "opponent-right" });
    expect(focusDoublesMoves(current, "own-left")).toBe(current);
    expect(setDoublesMovesInto(current, "opponent-left")).toBe(current);
    expect(setDoublesMovesInto(current, "own-left")).toBe(current);
    // A fainted pane slot that comes back is not chosen again until picked.
    current = hp(current, "own-left", "");
    expect(current.doubles.moves).toEqual({ slot: "own-right", into: "opponent-right" });
    expect(focusDoublesMoves(current, "own-left").doubles.moves).toEqual({ slot: "own-left", into: "opponent-right" });
  });

  it("intimidates living foes only, and a fainted Pokémon intimidates no one", () => {
    let current = start();
    current = updateDoublesBuild(current, current.doubles.slots["own-left"].key, { ...current.doubles.slots["own-left"].build, abilityId: "intimidate" });
    current = hp(current, "opponent-right", "0");
    expect(intimidateFoes(current.doubles, "own-left")).toEqual(["opponent-left"]);
    const applied = applyDoublesIntimidate(current, current.doubles.slots["own-left"].key);
    expect(applied.doubles.slots["opponent-left"].build.boosts.atk).toBe(-1);
    expect(applied.doubles.slots["opponent-right"].build).toBe(current.doubles.slots["opponent-right"].build);
    const holder = hp(current, "own-left", "0");
    expect(intimidateFoes(holder.doubles, "own-left")).toEqual([]);
    expect(applyDoublesIntimidate(holder, holder.doubles.slots["own-left"].key)).toBe(holder);
  });

  it("keeps working through Reset, a game change and a new Pokémon in the fainted slot", async () => {
    const fainted = hp(prepared(), "opponent-right", "0");
    const reset = resetDoubles(fainted);
    expect(DOUBLES_SLOTS.map((slot) => reset.doubles.slots[slot].build.currentHP)).toEqual([null, null, null, null]);
    const runtime = await loadBattleRuntime("scarlet_violet");
    const before = fainted.matchup;
    const after = changeBattleGame(before, runtime);
    expect(doublesFainted(followShared(fainted.doubles, before, after).slots)).toEqual({ "own-left": false, "own-right": false, "opponent-left": false, "opponent-right": false });
    // Another species keeps the HP typed (the 1v1 rule): still fainted, with no action.
    const changed = updateDoublesBuild(fainted, fainted.doubles.slots["opponent-right"].key, { ...fainted.doubles.slots["opponent-right"].build, speciesId: "raichu" });
    expect(changed.doubles.slots["opponent-right"].build).toMatchObject({ speciesId: "raichu", currentHP: 0 });
    expect(getDoublesTurnInput(changed.doubles).pokemon["opponent-right"]).toBeNull();
  });
});

function summary(view: DoublesFixture, turn: DoublesTurnResult | null = view.turn) {
  return renderToStaticMarkup(createElement(DoublesSummary, {
    runtime: championsRuntime, cards: view.cards, names: view.names, turn, rollMode: "average", onRollModeChange: vi.fn(),
    replacement: null, movesControl: "moves-list", magicRoom: false, terrain: "",
    onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onToggleMega: vi.fn(), onToggleMechanic: vi.fn(),
    onActivateMove: vi.fn(), onChooseMove: vi.fn(), onShowMoves: vi.fn(), onTargetChange: vi.fn(), onShowStep: vi.fn(), onFixSettings: vi.fn(),
  }));
}

/** The four cards with Pikachu (opponent-right) at 0 HP, as useDoublesView makes them. */
function faintedView(actions: Partial<Record<DoublesSlotId, { moveId: string; target: DoublesSlotId | null }>>) {
  const current = hp(start(), "opponent-right", "0");
  const input = getDoublesTurnInput(current.doubles);
  const view = fixture({ actions });
  for (const slot of DOUBLES_SLOTS) {
    const action = view.cards[slot].action;
    view.cards[slot] = {
      ...view.cards[slot], slot: current.doubles.slots[slot], fainted: slot === "opponent-right",
      action: slot === "opponent-right" ? NO_ACTION : action, rule: action.moveId && slot !== "opponent-right" ? doublesTargetRule(input, slot, action.moveId) : null,
    };
  }
  return view;
}

const card = (html: string, slot: DoublesSlotId) => {
  const at = html.indexOf(`data-doubles-slot="${slot}"`);
  const next = DOUBLES_SLOTS.slice(DOUBLES_SLOTS.indexOf(slot) + 1).map((each) => html.indexOf(`data-doubles-slot="${each}"`)).find((index) => index > at);
  return html.slice(at, next ?? html.indexOf("data-doubles-turn"));
};

describe("the fainted card and the other cards", () => {
  it("shows Fainted and 0 / maximum HP with no move or target controls", () => {
    const html = summary(faintedView({ "own-left": { moveId: "rockslide", target: null } }));
    const pikachu = card(html, "opponent-right");
    expect(pikachu).toContain(`data-doubles-fainted="opponent-right" class="mt-1 text-xs font-semibold text-danger">${FAINTED}</p>`);
    expect(pikachu).toContain('<span class="text-xl font-bold text-text">0</span><span class="text-sm text-muted"> / 110 HP</span>');
    expect(pikachu).toMatch(/role="meter" aria-label="Pikachu current HP" aria-valuemin="0" aria-valuemax="110" aria-valuenow="0" aria-valuetext="Fainted: 0 of 110 HP"/);
    expect(pikachu).not.toMatch(/data-move-slot|data-doubles-no-move|data-doubles-all-moves|data-doubles-target|data-doubles-action|type="radio"/);
    expect(pikachu).not.toContain("Current HP must");
    // It keeps its name, and can still be changed or brought back.
    expect(pikachu).toContain('aria-label="Change Pikachu"');
    expect(pikachu).toContain('aria-label="Edit Pikachu HP"');
    expect(positionalIn(html)).toEqual([]);
  });

  it("names the lone foe a spread move reaches, and picks a single foe without a picker", () => {
    const html = summary(faintedView({ "own-left": { moveId: "rockslide", target: null }, "opponent-left": { moveId: "hydropump", target: "own-left" } }));
    expect(card(html, "own-left")).toContain('data-doubles-action="own-left" class="mt-1 wrap-anywhere text-xs text-muted">Rock Slide<span aria-hidden="true"> → </span><span class="sr-only"> targets </span>Blastoise</p>');
    const blastoise = card(html, "opponent-left");
    // Hydro Pump (normal) from Blastoise still offers your two Pokémon; its fainted ally is left out.
    expect([...blastoise.matchAll(/<input\b[^>]*type="radio"[^>]*value="([^"]+)"/g)].map((match) => match[1])).toEqual(["own-left", "own-right"]);
  });

  it("states the one target of an adjacent-foe move as a fact", () => {
    const view = faintedView({ "own-right": { moveId: "sludgebomb", target: "opponent-left" } });
    view.cards["own-right"] = { ...view.cards["own-right"], rule: { kind: "choose", options: ["opponent-left"] } };
    const venusaur = card(summary(view), "own-right");
    expect(venusaur).not.toContain('type="radio"');
    expect(venusaur).toMatch(/<p data-doubles-action="own-right" class="[^"]+">Sludge Bomb<span aria-hidden="true"> → <\/span><span class="sr-only"> targets <\/span>Blastoise<\/p>/);
  });

  it("lists no step for a turn where no Pokémon with a move acts, and shows the turn's facts", () => {
    const view = faintedView({ "own-left": { moveId: "flamethrower", target: null } });
    const empty = { status: "ready", start: { "own-left": { hp: 153, maximum: 153 }, "own-right": { hp: 155, maximum: 155 }, "opponent-left": null, "opponent-right": null },
      steps: [], hp: { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null }, startRows: [], facts: ["No target: both foes have fainted."],
      endOfTurn: { status: "ready", hp: { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null }, residuals: [], facts: [] } } satisfies DoublesTurnResult;
    const turn = summary(view, empty).slice(summary(view, empty).indexOf("data-doubles-turn"));
    expect(turn).not.toContain("<ol");
    expect(turn).toContain("No target: both foes have fainted.");
  });

  it("says No target for a move that reaches no Pokémon, and names the one foe of a random move", () => {
    const names = { "own-left": "Charizard", "own-right": "Venusaur", "opponent-left": "Blastoise", "opponent-right": "Pikachu" };
    expect(actionTargets(names, "own-left", { kind: "auto", hits: [] }, null)).toEqual({ arrow: false, text: "No target" });
    expect(actionTargets(names, "opponent-left", { kind: "auto", hits: [] }, null)).toEqual({ arrow: false, text: "No target" });
    expect(actionTargets(names, "own-left", { kind: "auto", hits: ["opponent-right"], random: true }, null)).toEqual({ arrow: true, text: "Pikachu" });
    expect(actionTargets(names, "own-left", { kind: "auto", hits: ["opponent-left", "opponent-right"], random: true }, null)).toEqual({ arrow: true, text: "a random foe" });
    expect(actionTargets(names, "own-left", { kind: "choose", options: [] }, null)).toEqual({ arrow: false, text: "No target" });
  });
});

describe("the Moves pane", () => {
  it("shows a fainted Pokémon as a disabled choice", () => {
    const names = { "own-left": "Charizard", "own-right": "Venusaur", "opponent-left": "Blastoise", "opponent-right": "Pikachu" };
    const props = { names, focus: "own-left", into: "opponent-left", fainted: { "opponent-right": true }, onFocusChange: vi.fn(), onIntoChange: vi.fn() } as unknown as ComponentProps<typeof DoublesMoves>;
    const html = renderToStaticMarkup(createElement(DoublesMoves, props, null));
    const radios = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(([input]) => [input.match(/value="([^"]+)"/)![1], input.includes('disabled=""')]);
    expect(radios).toEqual([
      ["own-left", false], ["own-right", false], ["opponent-left", false], ["opponent-right", true],
      ["opponent-left", false], ["opponent-right", true], ["own-right", false],
    ]);
    expect(html).toContain('<span class="font-semibold text-text">Pikachu</span><span class="text-muted"> · Fainted</span>');
    expect(positionalIn(html)).toEqual([]);
  });
});

describe("Last Respects in the Moves pane", () => {
  function lastRespects(contexts: Record<string, MoveContext>, faintedAtLeast?: number) {
    const attacker = { ...createBuild("houndstone"), abilityId: "sandrush" };
    const row: MoveDamageResult = { moveId: "lastrespects", kind: "needs-context", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: "", assumptions: [], reason: null, hits: null };
    const html = renderToStaticMarkup(createElement(MoveResults, {
      rows: [row], moveIds: ["lastrespects"], ownerId: "0:0", selectedMoveId: "lastrespects", onSelectMove: vi.fn(), contexts,
      onContextChange: vi.fn(), abilityId: attacker.abilityId, itemId: attacker.itemId, attackerName: "Houndstone", defenderName: "Blastoise",
      defenderHP: 154, sourceBuild: attacker, faintedAtLeast,
    }));
    return [...html.slice(html.indexOf("Party members that have fainted")).matchAll(/<option value="(\d)"([^>]*)>/g)].slice(0, 6).map(([, value, rest]) => `${value}${rest.includes("selected") ? "*" : ""}${rest.includes("disabled") ? " disabled" : ""}`);
  }

  it("counts at least its side's fainted Pokémon, as the turn does", () => {
    expect(lastRespects({})).toEqual(["0*", "1", "2", "3", "4", "5"]);
    expect(lastRespects({}, 1)).toEqual(["0 disabled", "1*", "2", "3", "4", "5"]);
    expect(lastRespects({ lastrespects: { fainted: 3 } }, 1)).toEqual(["0 disabled", "1", "2", "3*", "4", "5"]);
  });
});

describe("the 2v2 page with a fainted Pokémon", () => {
  it("raises no HP issue, shows the card fainted and keeps its Build settings", async () => {
    const current = hp(prepared(), "opponent-right", "0");
    state.doubles = current.doubles;
    const { default: CalculatorClient } = await import("@/app/(app)/calculator/CalculatorClient");
    const html = renderToStaticMarkup(createElement(CalculatorClient, { initialMode: "2v2" }));
    expect(html).not.toContain("Current HP must");
    expect(html).toContain('data-doubles-fainted="opponent-right"');
    const pikachu = html.slice(html.indexOf('data-doubles-slot="opponent-right"'), html.indexOf("data-doubles-turn"));
    expect(pikachu).not.toContain("data-move-slot");
    expect(html).toContain('data-build-region="opponent-right"');
    expect(html).not.toMatch(/data-build-toggle="opponent-right"[^>]*>[^<]*<[^>]*>\d+ issue/);
    // Rock Slide names the lone foe.
    expect(card(html, "own-left")).toContain("Rock Slide<span aria-hidden=\"true\"> → </span><span class=\"sr-only\"> targets </span>Blastoise");
  });
});

describe("the turn with a fainted Pokémon (engine)", () => {
  it("gives it no step and no HP; a spread move hits the lone foe for the start-of-turn damage into it", async () => {
    const { calculateDoublesMoves, calculateDoublesTurn } = await import("@/app/lib/battle/doubles-turn");
    const current = hp(target(prepared(), "own-right", "opponent-right"), "opponent-right", "0");
    const input = getDoublesTurnInput(current.doubles);
    const turn = calculateDoublesTurn(input);
    expect(turn.status).toBe("ready");
    if (turn.status !== "ready") return;
    expect(turn.steps.map((step) => [step.slot, step.hits.map((hit) => hit.slot)])).toEqual([["own-left", ["opponent-left"]], ["own-right", ["opponent-left"]]]);
    expect(turn.hp["opponent-right"]).toBeNull();
    const rows = calculateDoublesMoves(input, "own-left", "opponent-left").results;
    const rockSlide = rows.find((row) => row.moveId === "rockslide")!;
    expect([turn.steps[0].hits[0].min, turn.steps[0].hits[0].max]).toEqual([rockSlide.min, rockSlide.max]);
    // Lower than into both foes (0.75 each).
    const both = calculateDoublesTurn(getDoublesTurnInput(prepared().doubles));
    if (both.status !== "ready") throw new Error(both.status);
    const spread = both.steps.find((step) => step.slot === "own-left")!.hits.find((hit) => hit.slot === "opponent-left")!;
    expect(spread.max!).toBeLessThan(rockSlide.min!);
  });

  // Naming pass review CALC-1: the input's fainted slot is null, but the turn's text names the four Pokémon as their cards
  // do (doublesNames over all four builds), so a fainted twin or mirror partner does not rename the others.
  it("names each Pokémon in the turn's text as its card does when a twin or mirror partner has fainted", async () => {
    const { calculateDoublesTurn } = await import("@/app/lib/battle/doubles-turn");
    const { chosenBuild } = await import("@/app/(app)/calculator/PokemonChooser");
    const strings = (value: unknown, out: string[] = []): string[] => {
      if (typeof value === "string") out.push(value);
      else if (value && typeof value === "object") for (const each of Object.values(value)) strings(each, out);
      return out;
    };
    const named = (species: Partial<Record<DoublesSlotId, [string, string?]>>, fainted: DoublesSlotId, runtime = championsRuntime) => {
      let current: CalculatorState = { matchup: createMatchup(0, runtime), doubles: createDoubles(0, runtime) };
      for (const [slot, [id, ability]] of Object.entries(species) as [DoublesSlotId, [string, string?]][]) {
        const build = chosenBuild(id, runtime, "Doubles")!;
        current = updateDoublesBuild(current, current.doubles.slots[slot].key, ability ? { ...build, abilityId: ability } : build);
      }
      return hp(current, fainted, "0");
    };
    const turnText = (current: CalculatorState) => {
      const turn = calculateDoublesTurn(getDoublesTurnInput(current.doubles));
      expect(turn.status).toBe("ready");
      return strings(turn);
    };
    // Your Garchomp twins beside the opponent's Garchomp; your first one has fainted.
    let twins = named({ "own-left": ["garchomp"], "own-right": ["garchomp"], "opponent-left": ["garchomp"] }, "own-left");
    twins = target(move(twins, "opponent-right", "thunderbolt"), "opponent-right", "own-right");
    expect(doublesNames(twins.doubles.slots, championsRuntime)["own-right"]).toBe("Garchomp (yours, 2)");
    expect(getDoublesTurnInput(twins.doubles).names?.["own-right"]).toBe("Garchomp (yours, 2)");
    const twinText = turnText(twins);
    expect(twinText).toContain("Thunderbolt has no effect on Garchomp (yours, 2).");
    expect(twinText.filter((text) => /Garchomp(?! \((?:yours, [12]|opponent's)\))/.test(text))).toEqual([]);
    // A Garchomp mirror whose opponent's Garchomp has fainted: yours keeps its side word.
    let mirror = named({ "own-left": ["garchomp"], "opponent-left": ["garchomp"] }, "opponent-left");
    mirror = target(move(mirror, "opponent-right", "thunderbolt"), "opponent-right", "own-left");
    const mirrorText = turnText(mirror);
    expect(mirrorText).toContain("Thunderbolt has no effect on Garchomp (yours).");
    expect(mirrorText.filter((text) => /Garchomp(?! \(yours\))/.test(text))).toEqual([]);
    // Neutralizing Gas from the turn's start (settleDoublesStart and the turn's facts) over three Snorlax, one fainted.
    const sv = await loadBattleRuntime("scarlet_violet");
    let gas = named({
      "own-left": ["weezinggalar", "neutralizinggas"], "own-right": ["snorlax", "thickfat"],
      "opponent-left": ["snorlax", "thickfat"], "opponent-right": ["snorlax", "thickfat"],
    }, "opponent-left", sv);
    gas = target(move(gas, "own-left", "sludgebomb"), "own-left", "opponent-right");
    const gasText = turnText(gas);
    expect(gasText).toContain("Snorlax (opponent's, 2)'s Thick Fat is suppressed by Neutralizing Gas.");
    expect(gasText).toContain("Neutralizing Gas suppresses the abilities of Snorlax (yours) and Snorlax (opponent's, 2).");
    expect(gasText.filter((text) => /Snorlax(?! \((?:yours|opponent's, [12])\))/.test(text))).toEqual([]);
    // With no fainted Pokémon the input carries no names: the turn names its four Pokémon itself (the same names).
    expect(getDoublesTurnInput(createDoubles()).names).toBeUndefined();
  });
});

