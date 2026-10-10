import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { cardLabels, popupOf } from "@/app/(app)/training/board/playback";
import { createStepBuilder } from "@/app/(app)/training/log/protocol-steps";
import { createLogFormatter } from "@/app/(app)/training/log/protocol-text";
import type { TurnStep } from "@/app/(app)/training/model/view-types";
import { createMoveType } from "@/app/(app)/training/worker/move-type";
import { BATTLE_A, BATTLE_B, BATTLE_C, BATTLE_D } from "../fixtures/training-playback";

// The board's playback steps (log/protocol-steps.ts) from p1-channel lines recorded on the pinned simulator
// (tests/fixtures/training-playback.ts) and the log probe's lines (training-protocol-text.test.ts).

const moveType = (name: string) => runtime.movesById.get(name.toLowerCase().replace(/[^a-z0-9]+/g, ""))?.type ?? null;
function build(drains: readonly (readonly string[])[]) {
  const builder = createStepBuilder({ moveType, keyOf: (side, name) => `${side === "p1" ? "own" : "ai"}-${name.toLowerCase()}` });
  for (const drain of drains) builder.push(drain);
  return builder.turns();
}
const caption = (step: TurnStep) => [step.title, step.by, ...step.results].filter(Boolean).join(" · ");
const slot = (step: TurnStep, at: string) => step.slots.find((each) => each.slot === at);
/** What the page shows for a step: its popup ("Blizzard (Abomasnow)"), then each card's labels in the resolve beat. */
function seen(step: TurnStep) {
  const popup = popupOf(step);
  const slots = [...new Set([...step.slots.map((each) => each.slot), ...step.targets])];
  const cards = slots.map((at) => [slot(step, at)?.name ?? at, cardLabels(step, at)] as const)
    .filter(([, labels]) => labels.length).map(([name, labels]) => `${name}: ${labels.join(", ")}`);
  return [popup.sub ? `${popup.title} (${popup.sub})` : popup.title, ...cards].join(" | ");
}

describe("turn steps (p1 channel)", () => {
  const turns = build(BATTLE_A);

  it("plays each turn in protocol order: the popup, then the cards' results", () => {
    expect(turns[1].map(seen)).toEqual([
      "Abomasnow Mega Evolves",
      "U-turn (Staraptor)",
      "U-turn: Staraptor switches for Dragonite",
      "Sleep Powder (Venusaur) | Abomasnow: No effect",
      "Will-O-Wisp (Incineroar) | Dragonite: Burned",
      "Blizzard (Abomasnow) | Dragonite: Super effective | Venusaur: Super effective, Focus Sash",
      "End of turn | Dragonite: Leftovers, Burn",
    ]);
    expect(turns[2].map(seen)).toEqual([
      "Abomasnow switches for Garchomp",
      "Giga Drain (Venusaur) | Incineroar: Not very effective",
      "Dragon Dance | Dragonite: Attack +1, Speed +1",
      "Parting Shot (Incineroar) | Dragonite: Attack −1, Sp. Atk −1",
      "Parting Shot: Incineroar switches for Gyarados | Gyarados: Intimidate | Dragonite: Attack −1 | Venusaur: Attack −1",
      "End of turn | Dragonite: Leftovers, Burn",
    ]);
    expect(turns[3].map(seen)).toEqual(["Protect", "Protect", "Extreme Speed (Dragonite) | Dragonite: Rough Skin", "Swords Dance | Garchomp: Attack +2", "End of turn | Dragonite: Leftovers, Burn"]);
    expect(turns[4].map(seen)).toEqual([
      "Protect | own-right: Failed",
      "Rock Slide (Garchomp) | Dragonite: Super effective, Fainted | Venusaur: Fainted | Garchomp: Life Orb",
      "Absol replaces Dragonite · Staraptor replaces Venusaur | Absol: Pressure | Staraptor: Intimidate | Garchomp: Attack −1 | Gyarados: Attack −1",
    ]);
    expect(turns[5].map(seen)).toEqual([
      "Absol Mega Evolves", "Sucker Punch (Absol) | Absol: Rough Skin", "Brave Bird (Staraptor) | Staraptor: Recoil",
      "Rock Slide (Garchomp) | Staraptor: Super effective, Fainted | Garchomp: Life Orb", "Waterfall (Gyarados) | Absol: Fainted",
    ]);
  });

  it("damage: your HP exact, the AI's as its percentage, from and to; the move's type and targets", () => {
    const uturn = turns[1][1];
    expect(uturn).toMatchObject({ kind: "move", type: "Bug", actor: "opponent-right", targets: ["own-right"] });
    expect(slot(uturn, "own-right")).toEqual({
      slot: "own-right", key: "own-incineroar", name: "Incineroar", facts: [],
      hp: { from: { kind: "exact", current: 202, maximum: 202 }, to: { kind: "exact", current: 173, maximum: 202 } },
    });
    const brave = turns[5][2];
    expect(slot(brave, "own-right")?.hp).toEqual({ from: { kind: "exact", current: 202, maximum: 202 }, to: { kind: "exact", current: 76, maximum: 202 } });
    // Recoil changes the user's HP without highlighting it.
    expect(slot(brave, "opponent-left")).toMatchObject({ hp: { from: { kind: "percent", percent: 100 }, to: { kind: "percent", percent: 73 } }, facts: ["Recoil"] });
    expect(brave.targets).toEqual(["own-right"]);
    // The g/y/r suffix at exactly 50% and 20% (the board's HP colour) is kept.
    expect(slot(turns[5][3], "opponent-right")?.hp?.to).toEqual({ kind: "percent", percent: 20, color: "r" });
    // A drain heals its user without highlighting it.
    const gigaDrain = turns[2][1];
    expect(gigaDrain.targets).toEqual(["own-right"]);
    expect(slot(gigaDrain, "opponent-left")).toMatchObject({ hp: { from: { kind: "percent", percent: 1 }, to: { kind: "percent", percent: 9 } }, facts: [] });
  });

  it("a spread move hits two (a Focus Sash and a Life Orb on its cards); a KO faints both", () => {
    const blizzard = turns[1][5];
    expect(blizzard).toMatchObject({ title: "Blizzard", type: "Ice", actor: "own-left", targets: ["opponent-right", "opponent-left"], by: "Abomasnow", results: [] });
    expect(slot(blizzard, "opponent-right")).toMatchObject({ hp: { from: { kind: "percent", percent: 100 }, to: { kind: "percent", percent: 17 } }, facts: ["Super effective"] });
    expect(slot(blizzard, "opponent-left")).toMatchObject({ hp: { from: { kind: "percent", percent: 100 }, to: { kind: "percent", percent: 1 } }, facts: ["Super effective", "Focus Sash"] });
    const rockSlide = turns[4][1];
    expect(rockSlide.targets).toEqual(["opponent-right", "opponent-left"]);
    expect(slot(rockSlide, "opponent-right")).toMatchObject({ fainted: true, hp: { from: { kind: "percent", percent: 5 }, to: { kind: "percent", percent: 0 } } });
    expect(slot(rockSlide, "opponent-left")).toMatchObject({ fainted: true, hp: { to: { kind: "percent", percent: 0 } } });
    expect(slot(rockSlide, "own-left")).toMatchObject({ facts: ["Life Orb"], hp: { from: { kind: "exact", current: 165, maximum: 183 }, to: { kind: "exact", current: 147, maximum: 183 } } });
  });

  it("status moves: Will-O-Wisp burns, Swords Dance +2 on its user, Dragon Dance two stats; immunity", () => {
    const wisp = turns[1][4];
    expect(wisp).toMatchObject({ type: "Fire", by: "Incineroar", targets: ["opponent-right"], results: [] });
    expect(slot(wisp, "opponent-right")).toMatchObject({ status: "brn", facts: ["Burned"] });
    const dance = turns[3][3];
    expect(dance).toMatchObject({ title: "Swords Dance", by: null, targets: ["own-left"], actor: "own-left", results: [] });
    expect(slot(dance, "own-left")).toMatchObject({ boosts: { atk: 2 }, facts: ["Attack +2"] });
    expect(slot(turns[2][2], "opponent-right")?.boosts).toEqual({ atk: 1, spe: 1 });
    expect(turns[1][3]).toMatchObject({ title: "Sleep Powder", targets: ["own-left"], results: [] });
    expect(slot(turns[1][3], "own-left")?.facts).toEqual(["No effect"]);
  });

  it("Protect: its own step on its user, a protected target, and a failed Protect", () => {
    expect(turns[3][0]).toMatchObject({ title: "Protect", by: null, type: "Normal", targets: ["own-right"], slots: [] });
    const [, turn1] = build(BATTLE_B);
    expect(turn1.map(seen)).toEqual([
      "Abomasnow Mega Evolves", "Protect", "Fake Out (Incineroar)", "Staraptor flinched", "Blizzard (Abomasnow) | Venusaur: Protected | Staraptor: Super effective, Fainted",
    ]);
    const blizzard = turn1[4];
    expect(blizzard.targets.sort()).toEqual(["opponent-left", "opponent-right"]);
    expect(slot(blizzard, "opponent-left")).toMatchObject({ facts: ["Protected"] });
    expect(slot(blizzard, "opponent-right")).toMatchObject({ fainted: true, hp: { to: { kind: "percent", percent: 0 } } });
    expect(turn1[3]).toMatchObject({ kind: "cant", targets: ["opponent-right"], type: null });
    expect(turns[4][0]).toMatchObject({ title: "Protect", results: ["Failed"], targets: ["own-right"] });
    // Psychic Terrain stops a priority move on its target: named on that card, as the log names it.
    const start = ["|switch|p1a: Absol|Absol, L50, M|167/167", "|switch|p1b: Aggron|Aggron, L50, M|147/147", "|switch|p2a: Garchomp|Garchomp, L50, M|100/100", "|switch|p2b: Indeedee|Indeedee-F, L50, F|100/100", "|turn|1"];
    const [, terrain] = build([start, ["|", "|move|p1a: Absol|Sucker Punch|p2b: Indeedee", "|-activate|p2b: Indeedee|move: Psychic Terrain", "|", "|upkeep"]]);
    expect(terrain.map(seen)).toEqual(["Sucker Punch (Absol) | Indeedee: Psychic Terrain"]);
  });

  it("a miss and a move with no target", () => {
    const start = ["|switch|p1a: Abomasnow|Abomasnow, L50, M|197/197", "|switch|p1b: Aegislash|Aegislash, L50, F|167/167", "|switch|p2a: Absol|Absol, L50, F|100/100", "|switch|p2b: Altaria|Altaria, L50, F|100/100", "|turn|1"];
    const turn = ["|", "|move|p1b: Aegislash|Poltergeist|p2b: Altaria|[miss]", "|-miss|p1b: Aegislash|p2b: Altaria", "|move|p1b: Aegislash|Poltergeist|p2: Absol|[notarget]", "|-fail|p1b: Aegislash", "|", "|upkeep"];
    const [, steps] = build([start, turn]);
    expect(steps.map(seen)).toEqual(["Poltergeist (Aegislash) | Altaria: Missed", "Poltergeist | own-right: No target"]);
    expect(steps.map(caption)).toEqual(["Poltergeist · Aegislash", "Poltergeist · No target"]);
    expect(steps[0]).toMatchObject({ type: "Ghost", targets: ["opponent-left"] });
    expect(slot(steps[0], "opponent-left")?.facts).toEqual(["Missed"]);
    // No target: the user's card is the one highlighted, so the popup needs no name.
    expect(steps[1].targets).toEqual(["own-right"]);
  });

  it("switches: a switch, a U-turn into a switch, Parting Shot's, and replacements, each card entering with its HP", () => {
    expect(turns[2][0]).toMatchObject({ kind: "switch", title: "Abomasnow switches for Garchomp", targets: ["own-left"] });
    expect(turns[2][0].slots[0]).toMatchObject({ slot: "own-left", key: "own-garchomp", entered: true, hp: { from: { kind: "exact", current: 183, maximum: 183 } } });
    const uturn = turns[1][2];
    expect(uturn).toMatchObject({ kind: "switch", title: "U-turn: Staraptor switches for Dragonite", type: null, targets: ["opponent-right"] });
    expect(uturn.slots).toEqual([{ slot: "opponent-right", key: "ai-dragonite", name: "Dragonite", entered: true, facts: [], status: "", hp: { from: { kind: "percent", percent: 100 }, to: { kind: "percent", percent: 100 } } }]);
    // Parting Shot's switch carries Gyarados's Intimidate: Attack −1 on both foes (their stages after it).
    const parting = turns[2][4];
    expect(parting.targets).toEqual(["own-right"]);
    expect(slot(parting, "own-right")).toMatchObject({ key: "own-gyarados", entered: true, facts: ["Intimidate"] });
    expect(slot(parting, "opponent-right")).toMatchObject({ boosts: { atk: -1, spe: 1, spa: -1 }, facts: ["Attack −1"] });
    expect(slot(parting, "opponent-left")).toMatchObject({ boosts: { atk: -2 } });
    expect(turns[4][2].targets).toEqual(["opponent-right", "opponent-left"]);
    // A drag: the move's name leads the sentence.
    const start = ["|switch|p1a: Garchomp|Garchomp, L50, M|183/183", "|switch|p1b: Gyarados|Gyarados, L50, M|202/202", "|switch|p2a: Absol|Absol, L50, F|100/100", "|switch|p2b: Skarmory|Skarmory, L50, F|100/100", "|turn|1"];
    const turn = ["|", "|move|p2b: Skarmory|Whirlwind|p1a: Garchomp", "|drag|p1a: Incineroar|Incineroar, L50, M|150/202", "|", "|upkeep"];
    const [, steps] = build([start, turn]);
    expect(steps.map(seen)).toEqual(["Whirlwind (Skarmory)", "Whirlwind: Garchomp switches for Incineroar"]);
    expect(slot(steps[1], "own-left")).toMatchObject({ key: "own-incineroar", entered: true, hp: { from: { kind: "exact", current: 150, maximum: 202 } } });
  });

  it("Mega Evolution, and the end of turn as one step (Leftovers and burn; its net HP)", () => {
    expect(turns[5][0]).toMatchObject({ kind: "mega", title: "Absol Mega Evolves", targets: ["opponent-right"], slots: [{ slot: "opponent-right", key: "ai-absol", mega: true }] });
    const end = turns[1][6];
    expect(end).toMatchObject({ kind: "end", title: "End of turn", type: null, targets: ["opponent-right"] });
    // Leftovers 17 → 23 then burn 23 → 17: no net change, both facts.
    expect(end.slots).toEqual([{ slot: "opponent-right", key: "ai-dragonite", name: "Dragonite", facts: ["Leftovers", "Burn"] }]);
    const residual = ["|", "|switch|p2a: Dragonite|Dragonite, L50, M|17/100 brn|[from] U-turn", "|", "|-weather|Snowscape|[upkeep]", "|-damage|p2a: Dragonite|11/100 brn|[from] brn", "|-weather|none", "|upkeep"];
    const [, turn1] = build([...BATTLE_A.slice(0, 3), residual]);
    // It comes in burned, as its switch line shows (the board after the turn could show more).
    expect(turn1.find((step) => step.kind === "switch")?.slots[0]).toMatchObject({ entered: true, status: "brn" });
    expect(turn1.at(-1)).toMatchObject({ title: "End of turn", results: ["Weather ended"], slots: [{ slot: "opponent-right", hp: { from: { kind: "percent", percent: 17 }, to: { kind: "percent", percent: 11 } }, facts: ["Burn"] }] });
    // The field's result under the end of turn's popup, not on the card.
    expect(seen(turn1.at(-1)!)).toBe("End of turn (Weather ended) | Dragonite: Burn");
    // Nothing changed at the end of turn: no step.
    expect(turns[5].some((step) => step.kind === "end")).toBe(false);
  });

  it("a move's type with its user's ability where you know it: Pixilate after a Mega Evolution, a sheet's, one the channel showed", () => {
    const known = new Map<string, string | null>([["p2:Sylveon", null], ["p1:Gardevoir", "Trace"]]);
    const typed = createMoveType((user) => known.get(`${user.side}:${user.name}`) ?? null);
    // Both teams have Gardevoir (the team preview's sixes): each is named with its team.
    const teams = { p1: ["Gardevoir", "Garchomp", "Incineroar", "Gyarados", "Aegislash", "Aggron"], p2: ["Gardevoir", "Sylveon", "Absol", "Altaria", "Ampharos", "Annihilape"] };
    const builder = createStepBuilder({ moveType: typed, teams });
    builder.push([
      "|switch|p1a: Gardevoir|Gardevoir, L50, F|175/175", "|switch|p1b: Garchomp|Garchomp, L50, M|183/183",
      "|switch|p2a: Gardevoir|Gardevoir, L50, F|100/100", "|switch|p2b: Sylveon|Sylveon, L50, F|100/100", "|turn|1",
    ]);
    builder.push([
      "|", "|move|p1a: Gardevoir|Hyper Voice|p2a: Gardevoir|[spread] p2a,p2b", "|-damage|p2a: Gardevoir|80/100", "|-damage|p2b: Sylveon|85/100",
      "|detailschange|p2a: Gardevoir|Gardevoir-Mega, L50, F", "|-mega|p2a: Gardevoir|Gardevoir|Gardevoirite",
      "|move|p2a: Gardevoir|Hyper Voice|p1a: Gardevoir|[spread] p1a,p1b", "|-damage|p1a: Gardevoir|140/175", "|-damage|p1b: Garchomp|90/183",
      // Sylveon's ability is closed and it has two: its Hyper Voice stays Normal until the channel shows Pixilate.
      "|move|p2b: Sylveon|Hyper Voice|p1a: Gardevoir|[spread] p1a,p1b", "|-damage|p1a: Gardevoir|120/175", "|-damage|p1b: Garchomp|50/183",
      "|-ability|p2b: Sylveon|Pixilate", "|move|p2b: Sylveon|Quick Attack|p1b: Garchomp", "|-damage|p1b: Garchomp|40/183",
      "|", "|upkeep", "|turn|2",
    ]);
    const moves = builder.turns()[1].filter((step) => step.kind === "move").map((step) => `${step.title} (${step.by}): ${step.type}`);
    expect(moves).toEqual(["Hyper Voice (Gardevoir (yours)): Normal", "Hyper Voice (Gardevoir (opponent's)): Fairy", "Hyper Voice (Sylveon): Normal", "Quick Attack (Sylveon): Fairy"]);
    expect(builder.turns()[0].map((step) => step.title)).toEqual(["Gardevoir (yours) comes in · Garchomp comes in · Gardevoir (opponent's) comes in · Sylveon comes in"]);
    expect(builder.turns()[1].find((step) => step.kind === "mega")?.title).toBe("Gardevoir (opponent's) Mega Evolves");
    // A move the -ate abilities leave alone, and Liquid Voice's sound moves.
    expect(typed("Weather Ball", { side: "p2", name: "Sylveon", species: "Sylveon", ability: "Pixilate" })).toBe("Normal");
    expect(typed("Hyper Voice", { side: "p2", name: "Primarina", species: "Primarina", ability: "Liquid Voice" })).toBe("Water");
    expect(typed("Rock Slide", null)).toBe("Rock");
  });

  it("a hit before its Sitrus Berry: the HP's lowest point in the step besides before and after", () => {
    const start = ["|switch|p1a: Absol|Absol, L50, M|3/167", "|switch|p1b: Altaria|Altaria, L50, M|119/182", "|switch|p2a: Garchomp|Garchomp, L50, M|79/100 brn", "|switch|p2b: Indeedee|Indeedee-F, L50, F|72/100", "|turn|3"];
    const turn = [
      "|", "|move|p1a: Absol|Close Combat|p2a: Garchomp", "|-damage|p2a: Garchomp|16/100 brn", "|-unboost|p1a: Absol|def|1", "|-unboost|p1a: Absol|spd|1",
      "|-damage|p1a: Absol|0 fnt|[from] ability: Rough Skin|[of] p2a: Garchomp", "|-enditem|p2a: Garchomp|Sitrus Berry|[eat]",
      "|-heal|p2a: Garchomp|41/100 brn|[from] item: Sitrus Berry", "|faint|p1a: Absol", "|", "|upkeep",
    ];
    const [, , , [closeCombat]] = build([start, turn]);
    expect(seen(closeCombat)).toBe("Close Combat (Absol) | Garchomp: Sitrus Berry | Absol: Defense −1, Sp. Def −1, Rough Skin, Fainted");
    expect(slot(closeCombat, "opponent-right")?.hp).toEqual({ from: { kind: "percent", percent: 79 }, to: { kind: "percent", percent: 41 }, low: { kind: "percent", percent: 16 } });
    // A plain hit, or a faint, has no low point.
    expect(slot(closeCombat, "own-left")?.hp).toEqual({ from: { kind: "exact", current: 3, maximum: 167 }, to: { kind: "exact", current: 0, maximum: 167 } });
    expect(turns.flat().filter((step) => step.slots.some((each) => each.hp?.low)).map((step) => step.title)).toEqual([]);
  });

  it("names nothing the log does not (items, abilities and moves)", () => {
    const formatter = createLogFormatter();
    for (const drain of BATTLE_A) formatter.push(drain);
    const log = formatter.turns().flat().map((line) => line.text).join("\n");
    const names = new Set([...runtime.itemsById.values(), ...runtime.abilitiesById.values(), ...runtime.movesById.values()].map((each) => each.name));
    const words = turns.flat().flatMap((step) => [step.title, ...step.results, ...step.slots.flatMap((each) => each.facts)]);
    const named = [...names].filter((name) => words.some((word) => word.includes(name)));
    expect(named.length).toBeGreaterThan(10);
    for (const name of named) expect(log, name).toContain(name);
  });

  it("waking up as it moves is in its own move's step; a Lum Berry's cure in the step that ate it; Trace on its card", () => {
    const turns = build(BATTLE_C);
    expect(turns[0].map(seen)).toEqual(["Venusaur comes in · Gardevoir comes in · Dragonite comes in · Garchomp comes in | Gardevoir: Traced Rough Skin"]);
    expect(turns[1].map(seen)).toEqual([
      "Swords Dance | Garchomp: Attack +2",
      "Hypnosis (Gardevoir) | Garchomp: Asleep, Lum Berry, Woke up",
      "Sleep Powder (Venusaur) | Dragonite: Asleep",
      "Dragonite is asleep",
    ]);
    expect(slot(turns[1][1], "opponent-left")?.status).toBe("");
    // Turn 2: Dragonite wakes up (-curestatus right before its move line), not at the end of the step before it.
    expect(turns[2].map(seen)).toEqual([
      "Extreme Speed (Dragonite) | Dragonite: Woke up, Life Orb",
      "Swords Dance | Garchomp: Attack +2",
      "Calm Mind | Gardevoir: Sp. Atk +1, Sp. Def +1",
      "Growth | Venusaur: Attack +1, Sp. Atk +1",
    ]);
    expect(slot(turns[2][0], "opponent-right")).toMatchObject({ status: "", hp: { from: { kind: "percent", percent: 100 }, to: { kind: "percent", percent: 90 } } });
    expect(turns[2][0].targets).toEqual(["own-left"]);
    expect(turns[4][1]).toMatchObject({ title: "Swords Dance", slots: [{ slot: "opponent-left", facts: ["Attack unchanged"], boosts: { atk: 6 } }] });
  });

  it("Ally Switch swaps two cards and keeps their stages; Solar Beam's charge turn is on its user only", () => {
    const [, , , , , turn5] = build(BATTLE_C);
    expect(turn5.map(seen)).toEqual([
      "Protect",
      "Ally Switch (Gardevoir) | Gardevoir: Switched places | Venusaur: Switched places",
      "Extreme Speed (Dragonite) | Dragonite: Rough Skin, Life Orb",
      "Solar Beam | Venusaur: Charging",
    ]);
    const allySwitch = turn5[1];
    expect(allySwitch.targets.sort()).toEqual(["own-left", "own-right"]);
    expect(slot(allySwitch, "own-left")).toMatchObject({ key: "own-gardevoir", entered: true, boosts: { spa: 3, spd: 3 } });
    expect(slot(allySwitch, "own-right")).toMatchObject({ key: "own-venusaur", entered: true, boosts: { atk: 3, spa: 3 } });
    expect(turn5[2].targets).toEqual(["own-left"]);
    expect(turn5[3]).toMatchObject({ type: "Grass", actor: "own-right", targets: ["own-right"], by: null });
  });

  it("confusion: confused as it moves and snapping out of it on its own move's card; hurting itself is a step of its own", () => {
    const turns = build(BATTLE_D);
    expect(turns[1].map(seen)).toEqual([
      "Swords Dance | Garchomp: Attack +2",
      "Calm Mind | Gardevoir: Sp. Atk +1, Sp. Def +1",
      "Hurricane (Dragonite) | Venusaur: Super effective, Confused | Dragonite: Life Orb",
      "Growth | Venusaur: Confused, Attack +1, Sp. Atk +1",
    ]);
    expect(turns[2].slice(2).map(seen)).toEqual(["Growth | Venusaur: Confused, Attack +1, Sp. Atk +1", "Hurricane (Dragonite) | Venusaur: Missed"]);
    expect(turns[3].slice(2).map(seen)).toEqual(["Venusaur is confused | Venusaur: Confusion", "Roost"]);
    expect(slot(turns[3][2], "own-left")?.hp).toEqual({ from: { kind: "exact", current: 23, maximum: 187 }, to: { kind: "exact", current: 1, maximum: 187 } });
    expect(slot(turns[3][3], "opponent-right")?.hp?.to).toEqual({ kind: "percent", percent: 100 });
    expect(turns[4].slice(2).map(seen)).toEqual(["Roost | opponent-right: Failed", "Growth | Venusaur: No longer confused, Attack +1, Sp. Atk +1"]);
  });

  it("the end of turn plays when only the field changed (the weather ended)", () => {
    const start = ["|switch|p1a: Abomasnow|Abomasnow, L50, M|197/197", "|switch|p1b: Gyarados|Gyarados, L50, M|202/202", "|switch|p2a: Absol|Absol, L50, F|100/100", "|switch|p2b: Altaria|Altaria, L50, F|100/100", "|turn|5"];
    const turn = ["|", "|move|p1a: Abomasnow|Protect|p1a: Abomasnow", "|-singleturn|p1a: Abomasnow|Protect", "|", "|-weather|none", "|upkeep", "|turn|6"];
    const steps = build([start, turn])[5];
    expect(steps.map(seen)).toEqual(["Protect", "End of turn (Weather ended)"]);
    expect(steps[1]).toMatchObject({ kind: "end", results: ["Weather ended"], targets: [], slots: [] });
  });

  it("is append-only across drains (a step the page played never changes)", () => {
    const builder = createStepBuilder({ moveType });
    builder.push(BATTLE_A[0]);
    builder.push(BATTLE_A[1]);
    builder.push(BATTLE_A[2]);
    const mid = builder.turns()[1];
    expect(mid.map(caption)).toEqual(["Abomasnow Mega Evolves", "U-turn · Staraptor"]);
    builder.push(BATTLE_A[3]);
    expect(builder.turns()[1].slice(0, 2)).toEqual(mid);
  });
});
