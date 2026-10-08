import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { playerCandidates } from "@/app/(app)/training/ai/candidates";
import { createHabitModel } from "@/app/(app)/training/ai/habits";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import BattleEnd from "@/app/(app)/training/end/BattleEnd";
import type { PlayerQuestion, TurnRecord } from "@/app/(app)/training/model/decision";
import { DECAY, emptyHabits, parseHabits, type HabitsData } from "@/app/(app)/training/model/habits-data";
import type { TrainingBattle } from "@/app/(app)/training/model/view-types";
import {
  battleComparison, battleHabits, DECAY_FACT, enough, habitTrends, isEmptyHabits, shareText, weightedBattles, type TrendNames,
} from "@/app/(app)/training/setup/habit-trends";
import HabitTrends, { trendNames } from "@/app/(app)/training/setup/HabitTrends";
import { capture } from "../fixtures/jsx-capture";
import { makeView, type MonSpec } from "../fixtures/training-ai";
import { boardView, logTurns, runtime, trainingSetup } from "../fixtures/training";

vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

/** "Your trends" and the battle-end comparison (setup/habit-trends.ts): the recorded habits as facts. */
const names: TrendNames = trendNames(runtime);
const ids: TrendNames = { species: (id) => id, move: (id) => id };

/** 41 actions; the four contexts add up to the global row. */
function sample(): HabitsData {
  return {
    v: 1, battles: 5,
    classes: {
      "*": { protect: 9, switch: 4, "fake-out": 2, "attack-ko": 6, "attack-best": 10, "attack-spread": 5, "attack-other": 3, "speed-control": 2 },
      "high|true|false": { protect: 5, "attack-ko": 3, "attack-best": 2 },
      "mid|true|true": { protect: 1, switch: 1 },
      "high|false|false": { protect: 2, "attack-best": 8, "attack-spread": 5, "fake-out": 2, "speed-control": 2, "attack-other": 3 },
      "low|false|true": { protect: 1, switch: 3, "attack-ko": 3 },
    },
    targets: { "attack-ko": { threat: 4, weak: 2 }, "attack-best": { threat: 7, other: 3 }, "fake-out": { threat: 2 } },
    aims: { "attack-ko": { left: 3, right: 3 }, "attack-best": { left: 6, right: 4 }, "fake-out": { left: 2 }, "attack-other": { ally: 1 } },
    moves: {
      garchomp: { earthquake: 12, dragonclaw: 7, protect: 5, rockslide: 1 },
      incineroar: { fakeout: 2, flareblitz: 0.4 },
      sinistcha: { spore: 4, ragepowder: 3 },
      rillaboom: { grassyglide: 6 },
      whimsicott: { tailwind: 5 },
      charizard: { heatwave: 4 },
      gyarados: { waterfall: 3 },
      missingno: { notamove: 3.2 },
    },
    brings: { garchomp: 3.4, incineroar: 2.6, sinistcha: 0.3, rillaboom: 2, whimsicott: 1.6, charizard: 1, gyarados: 1.2, kingambit: 0.9 },
    leads: { "garchomp+incineroar": 2.5, "garchomp+sinistcha": 1, "charizard+whimsicott": 0.7, "gyarados+rillaboom": 0.6 },
    mega: { "*": { yes: 3, no: 3 }, "first|true": { yes: 2, no: 0.5 }, "first|false": { yes: 1, no: 0.5 }, "later|false": { yes: 0, no: 2 } },
  };
}

/**
 * The habits a browser stored after three battles on the dev page (pokedrafts:training:habits:v1:<user>.data; battle 1 a league
 * team, battles 2-3 a PokePaste on both sides, battle 3 forfeited): decayed fractions, legacy-free but parsed as the page does.
 */
const LIVE: HabitsData = parseHabits({"v":1,"battles":3,"classes":{"high|false|false":{"protect":1.62,"speed-control":0.81,"attack-best":0.81},"*":{"protect":5.23,"status-other":4.23,"speed-control":1.71,"switch":1.62,"attack-best":2.43,"attack-other":3.61,"attack-ko":3.51,"attack-spread":0.9},"high|true|false":{"protect":2.71,"switch":0.81,"attack-best":0.81,"attack-ko":1.71,"attack-other":2.8,"status-other":0.9},"high|false|true":{"status-other":0.81},"mid|true|false":{"status-other":1.62,"attack-best":0.81,"protect":0.9,"speed-control":0.9},"low|true|false":{"switch":0.81,"attack-ko":1.8},"high|true|true":{"attack-other":0.81,"attack-spread":0.9},"mid|true|true":{"status-other":0.9}},"targets":{"status-other":{"other":1.71,"threat":1.71,"weak":0.81},"attack-best":{"threat":2.43},"attack-other":{"other":0.81,"threat":1.9},"attack-ko":{"other":0.9}},"moves":{"altaria":{"protect":0.81,"willowisp":2.43,"tailwind":0.81},"ampharos":{"protect":0.81},"alcremie":{"mysticalfire":2.43},"absol":{"detect":0.81,"closecombat":0.81,"suckerpunch":0.81},"charizard":{"solarbeam":0.9,"protect":1},"incineroar":{"flareblitz":1.9,"protect":0.9,"partingshot":0.9},"garchomp":{"protect":0.9,"rockslide":0.9,"earthquake":1.8},"whimsicott":{"encore":0.9,"moonblast":0.9,"tailwind":0.9}},"brings":{"altaria":0.81,"ampharos":0.81,"absol":0.81,"alcremie":0.81,"charizard":1.9,"incineroar":1.9,"garchomp":0.9,"whimsicott":0.9},"leads":{"altaria+ampharos":0.81,"charizard+incineroar":1.9},"mega":{"*":{"yes":1,"no":1.8},"first|true":{"yes":1,"no":0.9},"later|true":{"yes":0,"no":0.9}},"aims":{"status-other":{"left":2.61,"right":1.62},"attack-best":{"right":0.81,"left":1.62},"attack-other":{"left":1.71,"right":1},"attack-ko":{"left":0.9}}});

/**
 * The same browser's record after a fourth battle (PokePaste on both sides, forfeited during turn 5's Parting Shot switch). Its
 * log: T1 Fake Out -> Garchomp (right foe), Heat Wave (spread), no Mega; T2 a switch, Charizard Mega Evolves and flinches; T3
 * Rock Slide (spread), Charizard faints before moving; T4 Protect, Flare Blitz -> Garchomp (right); T5 Protect (failed), Parting
 * Shot -> Incineroar (left foe). 8 actions.
 */
const LIVE_AFTER: HabitsData = parseHabits({"v":1,"battles":4,"classes":{"high|false|false":{"protect":2.458,"speed-control":0.7290000000000001,"attack-best":0.7290000000000001,"switch":1,"attack-spread":1,"attack-ko":1,"status-other":1},"*":{"protect":6.707000000000001,"status-other":4.807,"speed-control":1.539,"switch":2.458,"attack-best":2.1870000000000003,"attack-other":3.249,"attack-ko":5.159,"attack-spread":1.81,"fake-out":1},"high|true|false":{"protect":2.439,"switch":0.7290000000000001,"attack-best":0.7290000000000001,"attack-ko":2.5389999999999997,"attack-other":2.52,"status-other":0.81,"fake-out":1},"high|false|true":{"status-other":0.7290000000000001,"protect":1},"mid|true|false":{"status-other":1.4580000000000002,"attack-best":0.7290000000000001,"protect":0.81,"speed-control":0.81},"low|true|false":{"switch":0.7290000000000001,"attack-ko":1.62},"high|true|true":{"attack-other":0.7290000000000001,"attack-spread":0.81},"mid|true|true":{"status-other":0.81}},"targets":{"status-other":{"other":2.5389999999999997,"threat":1.539,"weak":0.7290000000000001},"attack-best":{"threat":2.1870000000000003},"attack-other":{"other":0.7290000000000001,"threat":1.71},"attack-ko":{"other":0.81,"threat":1},"fake-out":{"threat":1}},"moves":{"altaria":{"protect":0.7290000000000001,"willowisp":2.1870000000000003,"tailwind":0.7290000000000001},"ampharos":{"protect":0.7290000000000001},"alcremie":{"mysticalfire":2.1870000000000003},"absol":{"detect":0.7290000000000001,"closecombat":0.7290000000000001,"suckerpunch":0.7290000000000001},"charizard":{"solarbeam":0.81,"protect":0.9,"heatwave":1},"incineroar":{"flareblitz":2.71,"protect":0.81,"partingshot":1.81,"fakeout":1},"garchomp":{"protect":2.81,"rockslide":1.81,"earthquake":1.62},"whimsicott":{"encore":0.81,"moonblast":0.81,"tailwind":0.81}},"brings":{"altaria":0.7290000000000001,"ampharos":0.7290000000000001,"absol":0.7290000000000001,"alcremie":0.7290000000000001,"charizard":2.71,"incineroar":2.71,"garchomp":1.81,"whimsicott":0.81},"leads":{"altaria+ampharos":0.7290000000000001,"charizard+incineroar":2.71},"mega":{"*":{"yes":1.9,"no":2.62},"first|true":{"yes":0.9,"no":1.81},"later|true":{"yes":0,"no":0.81},"later|false":{"yes":1,"no":0}},"aims":{"status-other":{"left":3.3489999999999998,"right":1.4580000000000002},"attack-best":{"right":0.7290000000000001,"left":1.4580000000000002},"attack-other":{"left":1.539,"right":0.9},"attack-ko":{"left":0.81,"right":1},"fake-out":{"right":1}}});

const texts = (lines: { label: string; unit: never | string; count: number; total: number; percent: number | null }[]) =>
  lines.map((line) => `${line.label}: ${shareText(line as Parameters<typeof shareText>[0])}`);

describe("habit trends (the helper)", () => {
  it("states every line from hand-built data: action shares, situations, targets, aims, moves, team preview and Mega", () => {
    const view = habitTrends(sample(), names)!;
    expect(view.battles).toBe(5);
    expect(texts(view.actions.lines)).toEqual([
      "Best attack: 24% (10 of 41 actions)", "Protect: 22% (9 of 41 actions)", "KO attempts: 15% (6 of 41 actions)",
      "Spread attacks: 12% (5 of 41 actions)", "Switch: 10% (4 of 41 actions)", "Other attacks: 7% (3 of 41 actions)",
      "Fake Out: 5% (2 of 41 actions)", "Speed control: 5% (2 of 41 actions)",
    ]);
    expect(texts(view.situations)).toEqual([
      "Protect when threatened: 50% (6 of 12 actions)", "Protect when not threatened: 10% (3 of 29 actions)",
      "Protect right after a Protect: 22% (2 of 9 actions)", "Switch at low HP (under 33%): 43% (3 of 7 actions)",
      "KO attempts among attacks: 25% (6 of 24 attacks)",
    ]);
    expect(texts(view.targets.lines)).toEqual([
      "The biggest threat: 72% (13 of 18 moves aimed at a foe)", "The lower-HP foe: 11% (2 of 18 moves aimed at a foe)", "Other: 17% (3 of 18 moves aimed at a foe)",
    ]);
    expect(texts(view.aims.lines)).toEqual(["Left foe: 58% (11 of 19 aimed moves)", "Right foe: 37% (7 of 19 aimed moves)", "Your partner: 5% (1 of 19 aimed moves)"]);
    // Species by total; top 3 by count; a species under 3 moves states no shares; unknown ids keep their id.
    expect(view.moves.map((species) => [species.name, Math.round(species.total)])).toEqual([
      ["Garchomp", 25], ["Sinistcha", 7], ["Rillaboom", 6], ["Whimsicott", 5], ["Charizard", 4], ["missingno", 3], ["Gyarados", 3], ["Incineroar", 2],
    ]);
    expect(view.moves[0].moves).toEqual([
      { id: "earthquake", name: "Earthquake", count: 12, percent: 48 }, { id: "dragonclaw", name: "Dragon Claw", count: 7, percent: 28 },
      { id: "protect", name: "Protect", count: 5, percent: 20 },
    ]);
    expect(view.moves.find((species) => species.speciesId === "missingno")!.moves).toEqual([{ id: "notamove", name: "notamove", count: 3.2, percent: 100 }]);
    expect(view.moves.find((species) => species.speciesId === "incineroar")!.moves).toBeNull();
    // 5 battles weigh 1 + 0.9 + … + 0.9⁴ = 4.0951; counts under 0.5 round to 0 and are left out.
    expect(view.weightedBattles).toBeCloseTo(4.0951, 10);
    expect(view.brought!.map((item) => `${item.name} ${Math.round(item.count)}`)).toEqual(["Garchomp 3", "Incineroar 3", "Rillaboom 2", "Whimsicott 2", "Gyarados 1", "Charizard 1"]);
    expect(view.leads!.map((item) => `${item.name} ${Math.round(item.count)}`)).toEqual(["Garchomp + Incineroar 3", "Garchomp + Sinistcha 1", "Charizard + Whimsicott 1"]);
    expect(texts(view.mega)).toEqual(["At the first chance: 75% (3 of 4 battles)", "At a later chance: Fewer than 3 turns"]);
  });

  it("states a share only from 3 actions, turns or battles as the panel counts them (weighted, rounded)", () => {
    const at = (total: number) => habitTrends({ ...emptyHabits(), battles: 1, classes: { "*": { protect: total / 2, switch: total / 2 } } }, ids)!;
    expect(enough(2.49)).toBe(false);
    expect(enough(2.5)).toBe(true);
    expect(at(2.49).actions.lines).toEqual([]);
    expect(shareText({ unit: "actions", count: 1, total: 2.49, percent: null })).toBe("Fewer than 3 actions");
    // 2.6 weighted actions show as 3: the share is stated, never "Fewer than 3" for a count shown as 3.
    expect(texts(at(2.6).actions.lines)).toEqual(["Protect: 50% (1 of 3 actions)", "Switch: 50% (1 of 3 actions)"]);
    // A denominator of 1 (this battle's exact counts) reads in the singular.
    expect(shareText({ unit: "turns", count: 0, total: 1, percent: 0 })).toBe("0% (0 of 1 turn)");
    expect(shareText({ unit: "moves aimed at a foe", count: 1, total: 1, percent: 100 })).toBe("100% (1 of 1 move aimed at a foe)");
    expect(texts(at(3).actions.lines)).toEqual(["Protect: 50% (2 of 3 actions)", "Switch: 50% (2 of 3 actions)"]);
    // 2 battles weigh 1.9: the team preview lines wait for more.
    const few = habitTrends({ ...emptyHabits(), battles: 2, classes: { "*": { protect: 2 } }, brings: { garchomp: 1.9 }, mega: { "first|true": { yes: 1, no: 0.9 } } }, ids)!;
    expect(few.weightedBattles).toBeCloseTo(1.9, 12);
    expect(few.brought).toBeNull();
    expect(few.leads).toBeNull();
    expect(texts(few.mega)).toEqual(["At the first chance: Fewer than 3 battles", "At a later chance: Fewer than 3 turns"]);
    expect(texts(few.situations).every((text) => text.endsWith("Fewer than 3 actions") || text.endsWith("Fewer than 3 attacks"))).toBe(true);
    expect(few.targets.lines).toEqual([]);
    expect(few.aims.lines).toEqual([]);
    // 3 battles weigh 2.71, shown as 3: "3 battles recorded" is never followed by "Fewer than 3 battles".
    const three = habitTrends({ ...emptyHabits(), battles: 3, classes: { "*": { protect: 2 } }, brings: { garchomp: 2.71 }, leads: { "garchomp+incineroar": 2.71 }, mega: { "first|true": { yes: 1, no: 1.71 } } }, ids)!;
    expect(three.weightedBattles).toBeCloseTo(2.71, 12);
    expect(three.brought).toEqual([{ id: "garchomp", name: "garchomp", count: 2.71 }]);
    expect(three.leads).toEqual([{ id: "garchomp+incineroar", name: "garchomp + incineroar", count: 2.71 }]);
    expect(texts(three.mega)).toEqual(["At the first chance: 37% (1 of 3 battles)", "At a later chance: Fewer than 3 turns"]);
  });

  it("recomputes every line of a record a browser stored after three battles (counts decayed to fractions)", () => {
    const view = habitTrends(LIVE, names)!;
    expect(view.battles).toBe(3);
    // 23.24 actions: Protect 5.23 / 23.24 = 22.504% -> 23%; Spread attacks 0.9 -> 3.87% -> 4%.
    expect(texts(view.actions.lines)).toEqual([
      "Protect: 23% (5 of 23 actions)", "Other status moves: 18% (4 of 23 actions)", "Other attacks: 16% (4 of 23 actions)",
      "KO attempts: 15% (4 of 23 actions)", "Best attack: 10% (2 of 23 actions)", "Speed control: 7% (2 of 23 actions)",
      "Switch: 7% (2 of 23 actions)", "Spread attacks: 4% (1 of 23 actions)",
    ]);
    // Threatened 9.74 + 4.23 + 2.61 + 1.71 + 0.9 = 19.19 (Protect 2.71 + 0.9); not threatened 3.24 + 0.81 = 4.05 (Protect 1.62);
    // after a Protect 0.81 + 1.71 + 0.9 = 3.42 (no Protect); low HP 2.61 (Switch 0.81); attacks 3.51 + 2.43 + 0.9 + 3.61 = 10.45.
    expect(texts(view.situations)).toEqual([
      "Protect when threatened: 19% (4 of 19 actions)", "Protect when not threatened: 40% (2 of 4 actions)",
      "Protect right after a Protect: 0% (0 of 3 actions)", "Switch at low HP (under 33%): 31% (1 of 3 actions)",
      "KO attempts among attacks: 34% (4 of 10 attacks)",
    ]);
    // Threat 1.71 + 2.43 + 1.9 = 6.04, weak 0.81, other 1.71 + 0.81 + 0.9 = 3.42 of 10.27; left 6.84, right 3.43, partner 0.
    expect(texts(view.targets.lines)).toEqual([
      "The biggest threat: 59% (6 of 10 moves aimed at a foe)", "The lower-HP foe: 8% (1 of 10 moves aimed at a foe)", "Other: 33% (3 of 10 moves aimed at a foe)",
    ]);
    expect(texts(view.aims.lines)).toEqual(["Left foe: 67% (7 of 10 aimed moves)", "Right foe: 33% (3 of 10 aimed moves)", "Your partner: 0% (0 of 10 aimed moves)"]);
    expect(view.moves.map((species) => [species.name, Math.round(species.total), species.moves?.map((move) => `${move.name} ${Math.round(move.count)} (${move.percent}%)`).join(" · ") ?? null])).toEqual([
      ["Altaria", 4, "Will-O-Wisp 2 (60%) · Protect 1 (20%) · Tailwind 1 (20%)"],
      ["Incineroar", 4, "Flare Blitz 2 (51%) · Parting Shot 1 (24%) · Protect 1 (24%)"],
      ["Garchomp", 4, "Earthquake 2 (50%) · Protect 1 (25%) · Rock Slide 1 (25%)"],
      ["Whimsicott", 3, "Encore 1 (33%) · Moonblast 1 (33%) · Tailwind 1 (33%)"],
      ["Absol", 2, null], ["Alcremie", 2, null], ["Charizard", 2, null], ["Ampharos", 1, null],
    ]);
    // 3 battles weigh 2.71: the team preview is stated. Ties in count go by name.
    expect(view.brought!.map((item) => `${item.name} ${Math.round(item.count)}`)).toEqual(["Charizard 2", "Incineroar 2", "Garchomp 1", "Whimsicott 1", "Absol 1", "Alcremie 1"]);
    expect(view.leads!.map((item) => `${item.name} ${Math.round(item.count)}`)).toEqual(["Charizard + Incineroar 2", "Altaria + Ampharos 1"]);
    // First chance 1 + 0.9 = 1.9 battles, later 0.9 turns.
    expect(texts(view.mega)).toEqual(["At the first chance: Fewer than 3 battles", "At a later chance: Fewer than 3 turns"]);
  });

  it("rounds counts to whole numbers and takes percentages from the weighted counts", () => {
    const view = habitTrends({ ...emptyHabits(), battles: 2, classes: { "*": { protect: 8.6, switch: 32.7 } } }, ids)!;
    // 8.6 / 41.3 = 20.8%: 21%, with the counts 9 of 41.
    expect(texts(view.actions.lines)).toEqual(["Switch: 79% (33 of 41 actions)", "Protect: 21% (9 of 41 actions)"]);
    // A class whose weighted count rounds to 0 is left out of the action shares.
    expect(habitTrends({ ...emptyHabits(), battles: 9, classes: { "*": { protect: 0.4, switch: 5 } } }, ids)!.actions.lines.map((line) => line.id)).toEqual(["switch"]);
  });

  it("weights battles by 0.9 per battle, as the habit model decays them", () => {
    expect(weightedBattles(0)).toBe(0);
    expect(weightedBattles(1)).toBe(1);
    expect(weightedBattles(2)).toBeCloseTo(1.9, 12);
    expect(weightedBattles(3)).toBeCloseTo(2.71, 12);
    expect(weightedBattles(4)).toBeCloseTo(3.439, 12);
    // The model: a count of 1 per battle over n battles is Σ 0.9^k after the n-th battle.
    const model = createHabitModel(null);
    for (let n = 0; n < 4; n++) { model.startBattle(); model.observeBattle({ leads: null, revealed: ["chomp"] }, { speciesOf: () => "garchomp" }); }
    expect(model.data().brings.garchomp).toBeCloseTo(weightedBattles(4), 12);
    expect(DECAY_FACT).toBe("Recent battles count more (×0.9 per battle).");
  });

  it("returns null for empty data: nothing recorded, cleared, or only battles started", () => {
    expect(habitTrends(emptyHabits(), names)).toBeNull();
    expect(habitTrends(null, names)).toBeNull();
    expect(habitTrends({ ...emptyHabits(), battles: 4 }, names)).toBeNull();
    expect(isEmptyHabits({ ...emptyHabits(), battles: 4 })).toBe(true);
    expect(isEmptyHabits({ ...emptyHabits(), brings: { garchomp: 1 } })).toBe(false);
    expect(isEmptyHabits({ ...emptyHabits(), mega: { "*": { yes: 0, no: 1 } } })).toBe(false);
    // Unknown species in leads and brings keep their ids.
    const view = habitTrends({ ...emptyHabits(), battles: 4, brings: { zzz: 3 }, leads: { "garchomp+zzz": 3 } }, names)!;
    expect(view.brought).toEqual([{ id: "zzz", name: "zzz", count: 3 }]);
    expect(view.leads).toEqual([{ id: "garchomp+zzz", name: "Garchomp + zzz", count: 3 }]);
  });

  it("reads a legacy record (no aims, no Mega threat split) with zero denominators, one class and unknown ids", () => {
    // Stored before aims existed, with the Mega phase alone as its key; parsed as the page parses it.
    const legacy = parseHabits({
      v: 1, battles: 6, classes: { "*": { protect: 3.2, switch: 0 }, "low|true|false": { protect: 0.4 } }, targets: {},
      moves: { garchomp: { notamove: 3 }, zzzmon: { protect: 0.6 } }, brings: { garchomp: 4.1 }, leads: {}, mega: { first: { yes: 2, no: 1.5 } },
    });
    expect(legacy.aims).toEqual({});
    const view = habitTrends(legacy, names)!;
    // One class with a count; a class at 0 is left out.
    expect(texts(view.actions.lines)).toEqual(["Protect: 100% (3 of 3 actions)"]);
    // No threatened, calm or after-Protect context reaches 3; no attacks at all (a zero denominator).
    expect(texts(view.situations)).toEqual([
      "Protect when threatened: Fewer than 3 actions", "Protect when not threatened: Fewer than 3 actions",
      "Protect right after a Protect: Fewer than 3 actions", "Switch at low HP (under 33%): Fewer than 3 actions",
      "KO attempts among attacks: Fewer than 3 attacks",
    ]);
    expect(view.targets).toEqual({ unit: "moves aimed at a foe", total: 0, lines: [] });
    expect(view.aims).toEqual({ unit: "aimed moves", total: 0, lines: [] });
    expect(view.moves).toEqual([
      { speciesId: "garchomp", name: "Garchomp", total: 3, moves: [{ id: "notamove", name: "notamove", count: 3, percent: 100 }] },
      { speciesId: "zzzmon", name: "zzzmon", total: 0.6, moves: null },
    ]);
    // 6 battles weigh 4.69; no leads seen.
    expect(view.brought).toEqual([{ id: "garchomp", name: "Garchomp", count: 4.1 }]);
    expect(view.leads).toEqual([]);
    expect(texts(view.mega)).toEqual(["At the first chance: 57% (2 of 4 battles)", "At a later chance: Fewer than 3 turns"]);
    const html = renderToStaticMarkup(createElement(HabitTrends, { data: legacy, runtime, open: true, onToggle: () => undefined }));
    expect(html).toContain(">Fewer than 3 moves aimed at a foe</p>");
    expect(html).toContain(">Fewer than 3 aimed moves</p>");
    expect(html).toMatch(/<dt[^>]*>Leads \(battles\)<\/dt><dd[^>]*>None seen<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>zzzmon<\/dt><dd[^>]*>Fewer than 3 moves used<\/dd>/);
    // A corrupt record (a negative count) reads as nothing recorded.
    expect(habitTrends(parseHabits({ ...legacy, brings: { garchomp: -1 } }), names)).toBeNull();
  });
});

// ---------- The real habit model: this battle = after − before × DECAY ----------
const whimsicott: MonSpec = { side: "opponent", species: "whimsicott", slot: "opponent-left", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } };
const gyarados: MonSpec = { side: "opponent", species: "gyarados", slot: "opponent-right", moves: ["waterfall", "crunch", "dragondance", "protect"], ability: "intimidate", item: "gyaradosite", nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } };
const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const charizard: MonSpec = { side: "own", species: "charizard", slot: "own-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };

function question(turn = 1) {
  const view = makeView([whimsicott, gyarados, garchomp, charizard], { turn });
  const rows = damageRows(view, runtime);
  const worth = worthOf(view, rows, runtime);
  const player = playerCandidates(view, rows, worth, null, runtime, { mega: megaOutlook(view, rows, runtime) });
  const q: Extract<PlayerQuestion, { kind: "turn" }> = { kind: "turn", turn, options: player.kept.map((c) => ({ id: c.id, action: c.action, label: c.label })), slots: player.slots };
  return q;
}
const targetSlot = (key: string) => key === "p2:whimsicott" ? "opponent-left" as const : key === "p2:gyarados" ? "opponent-right" as const : null;
const turnRecord = (q: Extract<PlayerQuestion, { kind: "turn" }>, observed: TurnRecord["observed"], observedMega: TurnRecord["observedMega"] = null): TurnRecord => ({ turn: q.turn, question: q, observed, observedMega, opponent: {} });

/** One battle's turns: Protect + Air Slash, Dragon Claw + Heat Wave, a switch + Air Slash; Charizard Mega Evolves on turn `megaOn`. */
function playBattle(model: ReturnType<typeof createHabitModel>, q: Extract<PlayerQuestion, { kind: "turn" }>, megaOn: 1 | 2) {
  model.startBattle();
  model.observeTurn(turnRecord(q, {
    "own-left": { kind: "move", moveId: "protect", targetKey: null, spread: false },
    "own-right": { kind: "move", moveId: "airslash", targetKey: "p2:whimsicott", spread: false },
  }, megaOn === 1 ? "own-right" : null), { targetSlot });
  model.observeTurn(turnRecord(q, {
    "own-left": { kind: "move", moveId: "dragonclaw", targetKey: "p2:gyarados", spread: false },
    "own-right": { kind: "move", moveId: "heatwave", targetKey: null, spread: true },
  }, megaOn === 2 ? "own-right" : null), { targetSlot });
  model.observeTurn(turnRecord(q, {
    "own-left": { kind: "switch", toKey: "incineroar" },
    "own-right": { kind: "move", moveId: "airslash", targetKey: "p2:gyarados", spread: false },
  }), { targetSlot });
  model.observeBattle({ leads: ["chomp", "zard"], revealed: ["chomp", "zard"] }, { speciesOf: (key) => key === "chomp" ? "garchomp" : "charizard" });
}

describe("this battle compared with your usual", () => {
  it("recovers this battle's exact counts from the stored habits before and after it (the worker's model, restored from the record)", () => {
    const q = question();
    const history = createHabitModel(null);
    for (let i = 0; i < 3; i++) playBattle(history, q, 1);
    const before = history.data();
    // The worker builds a new model from the stored record for each battle.
    const worker = createHabitModel(JSON.parse(JSON.stringify(history.record())));
    playBattle(worker, q, 2);
    const after = worker.data();
    // The same battle on its own, from nothing.
    const alone = createHabitModel(null);
    playBattle(alone, q, 2);
    const exact = alone.data();
    const battle = battleHabits(before, after)!;
    expect(battle.classes["*"]).toEqual(exact.classes["*"]);
    expect(battle.targets).toEqual(exact.targets);
    expect(battle.mega).toEqual(exact.mega);
    expect(Object.values(battle.classes["*"]).reduce((sum, n) => sum + (n ?? 0), 0)).toBe(6);
    expect(Object.values(battle.classes["*"]).every((n) => Number.isInteger(n))).toBe(true);
    // The table: this battle's exact shares and the habits before it.
    const rows = battleComparison(before, after)!;
    const protect = exact.classes["*"].protect ?? 0;
    expect(rows.find((row) => row.id === "protect")).toEqual({
      id: "protect", label: "Protect", battle: `${Math.round(100 * protect / 6)}% (${protect} of 6 actions)`,
      usual: shareText({ unit: "actions", count: before.classes["*"].protect ?? 0, total: Object.values(before.classes["*"]).reduce((sum, n) => sum + (n ?? 0), 0), percent: Math.round(100 * (before.classes["*"].protect ?? 0) / Object.values(before.classes["*"]).reduce((sum, n) => sum + (n ?? 0), 0)) }),
    });
    // Mega: kept at the first chance, Mega Evolved at the next; the usual Mega Evolved at the first chance in all 3 (2.71 weighted
    // battles, shown as 3) and kept at every later chance (2 a battle: 5.42 weighted turns).
    expect(rows.find((row) => row.id === "mega-first")).toEqual({ id: "mega-first", label: "Mega Evolution at the first chance", battle: "No", usual: "100% (3 of 3 battles)" });
    expect(rows.find((row) => row.id === "mega-later")).toEqual({ id: "mega-later", label: "Mega Evolution at a later chance", battle: "50% (1 of 2 turns)", usual: "0% (0 of 5 turns)" });
  });

  it("matches a browser battle counted from its log: the stored record before and after it", () => {
    const battle = battleHabits(LIVE, LIVE_AFTER)!;
    expect(battle.classes["*"]).toEqual({ protect: 2, switch: 1, "fake-out": 1, "attack-ko": 2, "attack-spread": 1, "status-other": 1 });
    expect(battle.targets).toEqual({ "fake-out": { threat: 1 }, "attack-ko": { threat: 1 }, "status-other": { other: 1 } });
    expect(battle.mega).toEqual({ "*": { yes: 1, no: 1 }, "first|true": { yes: 0, no: 1 }, "later|false": { yes: 1, no: 0 } });
    // As the end screen showed it.
    expect(battleComparison(LIVE, LIVE_AFTER)!.map((row) => [row.label, row.battle, row.usual])).toEqual([
      ["Protect", "25% (2 of 8 actions)", "23% (5 of 23 actions)"],
      ["Switch", "13% (1 of 8 actions)", "7% (2 of 23 actions)"],
      ["Fake Out", "13% (1 of 8 actions)", "0% (0 of 23 actions)"],
      ["KO attempts", "25% (2 of 8 actions)", "15% (4 of 23 actions)"],
      ["Speed control", "0% (0 of 8 actions)", "7% (2 of 23 actions)"],
      ["The biggest threat targeted", "67% (2 of 3 moves aimed at a foe)", "59% (6 of 10 moves aimed at a foe)"],
      ["Mega Evolution at the first chance", "No", "Fewer than 3 battles"],
      ["Mega Evolution at a later chance", "100% (1 of 1 turn)", "Fewer than 3 turns"],
    ]);
  });

  it("states the main lines, leaves out lines without data this battle, and refuses a record that does not match", () => {
    const before: HabitsData = { ...emptyHabits(), battles: 4, classes: { "*": { protect: 9, switch: 4, "attack-ko": 10, "attack-best": 18 } }, targets: { "attack-ko": { threat: 8, weak: 2 } }, mega: { "first|true": { yes: 3, no: 1 } } };
    const decayed = (n: number) => n * DECAY;
    const after: HabitsData = {
      ...before, battles: 5,
      classes: { "*": { protect: decayed(9) + 1, switch: decayed(4), "attack-ko": decayed(10) + 2, "attack-best": decayed(18) + 1, "speed-control": 1 } },
      targets: { "attack-ko": { threat: decayed(8), weak: decayed(2) + 2 } },
      mega: { "first|true": { yes: decayed(3), no: decayed(1) } },
    };
    expect(battleComparison(before, after)).toEqual([
      { id: "protect", label: "Protect", battle: "20% (1 of 5 actions)", usual: "22% (9 of 41 actions)" },
      { id: "switch", label: "Switch", battle: "0% (0 of 5 actions)", usual: "10% (4 of 41 actions)" },
      { id: "fake-out", label: "Fake Out", battle: "0% (0 of 5 actions)", usual: "0% (0 of 41 actions)" },
      { id: "attack-ko", label: "KO attempts", battle: "40% (2 of 5 actions)", usual: "24% (10 of 41 actions)" },
      { id: "speed-control", label: "Speed control", battle: "20% (1 of 5 actions)", usual: "0% (0 of 41 actions)" },
      { id: "threat", label: "The biggest threat targeted", battle: "0% (0 of 2 moves aimed at a foe)", usual: "80% (8 of 10 moves aimed at a foe)" },
    ]);
    // A battle with a Mega chance at the start: Yes / No against the usual first-chance share.
    const mega = { ...after, mega: { "first|true": { yes: decayed(3) + 1, no: decayed(1) } } };
    expect(battleComparison(before, mega)!.find((row) => row.id === "mega-first")).toEqual({ id: "mega-first", label: "Mega Evolution at the first chance", battle: "Yes", usual: "75% (3 of 4 battles)" });
    // No actions this battle (a forfeit at team preview): no rows.
    expect(battleComparison(before, { ...before, battles: 5, classes: { "*": { protect: decayed(9), switch: decayed(4), "attack-ko": decayed(10), "attack-best": decayed(18) } }, targets: { "attack-ko": { threat: decayed(8), weak: decayed(2) } }, mega: { "first|true": { yes: decayed(3), no: decayed(1) } } })).toEqual([]);
    // Not this battle's record: cleared meanwhile, two battles apart, or counts that are not whole numbers.
    expect(battleComparison(before, { ...emptyHabits(), battles: 1 })).toBeNull();
    expect(battleComparison(before, { ...after, battles: 6 })).toBeNull();
    expect(battleComparison(before, { ...after, classes: { "*": { ...after.classes["*"], protect: 9.5 } } })).toBeNull();
    // From no habits at all: the first battle's counts as they are.
    expect(battleHabits(emptyHabits(), { ...emptyHabits(), battles: 1, classes: { "*": { protect: 2 } } })!.classes["*"]).toEqual({ protect: 2 });
  });
});

// ---------- Markup ----------
const FORBIDDEN = /\b(should|try|tip|consider|recommend|better|worse|good|bad|improve)\b/i;

describe("Your trends panel (SSR)", () => {
  it("is a collapsed disclosure by default: a heading button with aria-expanded and a hidden region", () => {
    const onToggle = vi.fn();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(HabitTrends, { data: sample(), runtime, open: false, onToggle })));
    expect(html).toMatch(/<h3[^>]*><button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>.*Your trends<\/button><\/h3>/);
    const controls = /aria-controls="([^"]+)"/.exec(html)![1];
    expect(html).toMatch(new RegExp(`<div id="${controls}" role="region" aria-labelledby="[^"]+" hidden=""`));
    expect(html).not.toContain("Actions");
    const button = elements.find((element) => element.type === "button" && element.props["data-training-trends-toggle"]);
    (button!.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("open: headings, definition lists and the facts, with the rest of the moves behind a disclosure", () => {
    const onToggle = vi.fn();
    const { result: html, elements } = capture(() => renderToStaticMarkup(createElement(HabitTrends, { data: sample(), runtime, open: true, onToggle })));
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/role="region"[^>]*hidden/);
    for (const title of ["Actions", "Situations", "Targets", "Moves by Pokémon", "Team preview", "Mega Evolution"]) expect(html).toMatch(new RegExp(`<h4 id="[^"]+"[^>]*>${title}</h4>`));
    expect(html).toContain("5 battles recorded. Recent battles count more (×0.9 per battle).");
    const pair = (term: string, value: string) => expect(html).toMatch(new RegExp(`<dt[^>]*>${term.replace(/[()+]/g, "\\$&")}</dt><dd[^>]*>${value.replace(/[()+]/g, "\\$&")}</dd>`));
    pair("Protect", "22% (9 of 41 actions)");
    pair("Protect when threatened", "50% (6 of 12 actions)");
    pair("Protect right after a Protect", "22% (2 of 9 actions)");
    pair("The biggest threat", "72% (13 of 18 moves aimed at a foe)");
    pair("Your partner", "5% (1 of 19 aimed moves)");
    pair("Garchomp", "Earthquake 12 (48%) · Dragon Claw 7 (28%) · Protect 5 (20%) · 25 moves used");
    pair("Incineroar", "Fewer than 3 moves used");
    pair("Most brought (battles)", "Garchomp 3 · Incineroar 3 · Rillaboom 2 · Whimsicott 2 · Gyarados 1 · Charizard 1");
    pair("Leads (battles)", "Garchomp + Incineroar 3 · Garchomp + Sinistcha 1 · Charizard + Whimsicott 1");
    pair("At the first chance", "75% (3 of 4 battles)");
    pair("At a later chance", "Fewer than 3 turns");
    // 8 species: 6 shown, 2 behind a native disclosure.
    expect(html).toMatch(/<details[^>]*><summary[^>]*>2 more Pokémon<\/summary><dl/);
    expect(html.split("<details")[0].match(/data-training-trend-moves=/g)).toHaveLength(6);
    expect(html.match(/data-training-trend-moves=/g)).toHaveLength(8);
    const visible = html.replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(FORBIDDEN);
    // No definition lines: Threatened's and Most brought's are in docs/training.md.
    expect(visible).not.toMatch(/Threatened:|half its HP|counts a Pokémon once/);
    expect(html.match(/<p\b/g)).toHaveLength(1);
    const button = elements.find((element) => element.type === "button" && element.props["data-training-trends-toggle"]);
    (button!.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("open with nothing recorded: No turns recorded", () => {
    const html = renderToStaticMarkup(createElement(HabitTrends, { data: emptyHabits(), runtime, open: true, onToggle: () => undefined }));
    expect(html).toContain(">No turns recorded</p>");
    expect(html).not.toContain("<h4");
  });
});

describe("battle end comparison (SSR)", () => {
  function ended(habitsBefore: HabitsData): TrainingBattle {
    return {
      id: 1, setup: trainingSetup(), seed: "sodium,1", phase: { kind: "ended", result: "win", forfeited: false },
      board: boardView({ turn: 3 }), log: logTurns(), ai: { status: "idle" }, lastPreview: null, habitsBefore, savedId: "saved-1", startedAt: 0,
    };
  }
  const before: HabitsData = { ...emptyHabits(), battles: 4, classes: { "*": { protect: 9, switch: 4, "attack-ko": 10, "attack-best": 18 } } };
  const after: HabitsData = { ...before, battles: 5, classes: { "*": { protect: 9 * DECAY + 1, switch: 4 * DECAY, "attack-ko": 10 * DECAY + 2, "attack-best": 18 * DECAY + 1 } } };

  it("is a table with column and row headers under its heading; lines without data this battle are left out", () => {
    const html = renderToStaticMarkup(createElement(BattleEnd, { battle: ended(before), onRematch: () => undefined, onChangeTeams: () => undefined, logText: "", habits: after }));
    const heading = /<h3 id="([^"]+)"[^>]*>This battle compared with your usual<\/h3>/.exec(html);
    expect(heading).not.toBeNull();
    expect(html).toContain(`<table aria-labelledby="${heading![1]}"`);
    expect(html).toMatch(/<th scope="col"[^>]*>This battle<\/th><th scope="col"[^>]*>Your usual<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Protect<\/th><td[^>]*>25% \(1 of 4 actions\)<\/td><td[^>]*>22% \(9 of 41 actions\)<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>KO attempts<\/th><td[^>]*>50% \(2 of 4 actions\)<\/td><td[^>]*>24% \(10 of 41 actions\)<\/td>/);
    expect(html.match(/data-training-comparison-row=/g)).toHaveLength(5);
    expect(html).not.toContain("biggest threat");
    expect(html).not.toContain("Mega Evolution");
    expect(html).toContain("Your usual: the habits recorded before this battle. Recent battles count more (×0.9 per battle).");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(FORBIDDEN);
  });

  it("states No turns recorded this battle for a battle without actions, and nothing when the record does not match", () => {
    const none = renderToStaticMarkup(createElement(BattleEnd, { battle: ended(emptyHabits()), onRematch: () => undefined, onChangeTeams: () => undefined, logText: "", habits: { ...emptyHabits(), battles: 1 } }));
    expect(none).toContain(">No turns recorded this battle</p>");
    const cleared = renderToStaticMarkup(createElement(BattleEnd, { battle: ended(before), onRematch: () => undefined, onChangeTeams: () => undefined, logText: "", habits: emptyHabits() }));
    expect(cleared).not.toContain("data-training-comparison");
  });
});
