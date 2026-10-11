// Step 0c: the Field conditions editor renders byte-equal markup before and after the move of CarriedFields, Whose and
// carriedToggles into EarlierTurnFields.tsx. step0c-old/BattleConditions.tsx is the pre-move file (step0c-make-old.cjs).
// npx vitest run --config scripts/.cache/calc-audit/status2/build/step0c-markup.config.mts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NewConditions, { describeDoublesConditions as describeNew, type CarriedControl, type ChargeToggle } from "@/app/(app)/calculator/BattleConditions";
import { carriedOptions, NO_CARRIED_OPTIONS } from "@/app/(app)/calculator/doubles-prep";
import { DOUBLES_SLOTS, slotSide, type DoublesCarried, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import OldConditions, { describeDoublesConditions as describeOld } from "./step0c-old/BattleConditions";

const NAMES: Record<DoublesSlotId, string> = { "own-left": "Charizard", "own-right": "Venusaur", "opponent-left": "Blastoise", "opponent-right": "Pikachu" };
const SPECIES: Record<DoublesSlotId, string> = { "own-left": "charizard", "own-right": "venusaur", "opponent-left": "blastoise", "opponent-right": "pikachu" };

function controls(runtime: BattleRuntime, builds: Record<DoublesSlotId, BattleBuild>, carried: Partial<Record<DoublesSlotId, DoublesCarried>>, issues: Partial<Record<DoublesSlotId, CarriedControl["issues"]>> = {}, only?: DoublesSlotId[]): CarriedControl[] {
  return DOUBLES_SLOTS.filter((slot) => !only || only.includes(slot)).map((slot) => {
    const value = carried[slot] ?? {};
    return {
      slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: NAMES[slot], value, issues: issues[slot],
      options: builds[slot].currentHP === 0 ? NO_CARRIED_OPTIONS : carriedOptions(builds[slot], runtime, !!value.sleep?.rest),
      onChange: () => undefined,
    };
  });
}

function charges(checked: Partial<Record<DoublesSlotId, boolean>>): ChargeToggle[] {
  return DOUBLES_SLOTS.map((slot) => ({ slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: NAMES[slot], checked: !!checked[slot], onChange: () => undefined }));
}

type Scenario = { name: string; props: Record<string, unknown>; carried?: CarriedControl[]; charged?: Partial<Record<DoublesSlotId, boolean>> };

function scenarios(runtime: BattleRuntime): Scenario[] {
  const plain = Object.fromEntries(DOUBLES_SLOTS.map((slot) => [slot, createBuild(SPECIES[slot], runtime)])) as Record<DoublesSlotId, BattleBuild>;
  const statused: Record<DoublesSlotId, BattleBuild> = {
    "own-left": { ...plain["own-left"], status: "slp" },
    "own-right": { ...plain["own-right"], status: "tox" },
    "opponent-left": { ...plain["opponent-left"], status: "frz" },
    "opponent-right": { ...plain["opponent-right"], currentHP: 0 },
  };
  const doublesField: BattleConditions = { ...createConditions(), gameType: "Doubles", weather: "Rain", terrain: "Grassy", critical: true, trickRoom: true,
    attackerSide: { ...createConditions().attackerSide, reflect: true, tailwind: true }, defenderSide: { ...createConditions().defenderSide, lightScreen: true } };
  const set: Partial<Record<DoublesSlotId, DoublesCarried>> = {
    "own-left": { sleep: { attempts: 2, rest: true }, confusion: { attempts: 3 }, substitute: 40 },
    "own-right": { toxic: 5 },
    "opponent-left": { freeze: { attempts: 1 }, confusion: { attempts: 0 } },
  };
  const issues = { "own-left": { sleep: "Charizard: it cannot have lost 3 turns to sleep.", substitute: "Charizard: too much." } };
  const base = { issues: [], onChange: () => undefined, runtime, names: { attackerSide: "Charizard", defenderSide: "Blastoise" } };
  return [
    { name: "1v1 Singles", props: { ...base, value: createConditions() } },
    { name: "1v1 Doubles with legends", props: { ...base, value: doublesField, sideLegends: { attackerSide: "Charizard’s side (yours)", defenderSide: "Charizard’s side (theirs)" } } },
    { name: "2v2 nothing set", props: { ...base, value: { ...createConditions(), gameType: "Doubles" }, variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" } },
      carried: controls(runtime, plain, {}), charged: {} },
    { name: "2v2 states set", props: { ...base, value: doublesField, variant: "doubles", sideLegends: { attackerSide: "Your side", defenderSide: "Opponent's side" } },
      carried: controls(runtime, statused, set, issues), charged: { "own-left": true, "opponent-right": true } },
    { name: "2v2 Charge without controls for two", props: { ...base, value: doublesField, variant: "doubles" },
      carried: controls(runtime, statused, set, {}, ["own-left", "opponent-left"]), charged: { "own-right": true } },
    { name: "2v2 no carried", props: { ...base, value: doublesField, variant: "doubles" }, carried: [], charged: { "own-left": true } },
  ];
}

describe("Step 0c: BattleConditions markup before and after the move", async () => {
  const runtimes: BattleRuntime[] = [championsRuntime, await loadBattleRuntime("scarlet_violet"), await loadBattleRuntime("sword_shield"), await loadBattleRuntime("ultra_sun_ultra_moon")];
  for (const runtime of runtimes) {
    for (const scenario of scenarios(runtime)) {
      it(`${runtime.profile.id}: ${scenario.name}`, () => {
        const props = { ...scenario.props, ...(scenario.carried ? { carried: scenario.carried, charge: charges(scenario.charged ?? {}) } : {}) };
        const before = renderToStaticMarkup(createElement(OldConditions as never, props as never));
        const after = renderToStaticMarkup(createElement(NewConditions as never, props as never));
        expect(after.length).toBeGreaterThan(500);
        expect(after).toBe(before);
        if (scenario.name === "2v2 states set") {
          for (const text of ["data-doubles-carried=\"own-left\"", "Turns lost to sleep", "data-doubles-substitute-hp", "Bad poison turns so far", "Confusion turns so far", "it cannot have lost 3 turns to sleep."]) expect(after).toContain(text);
          expect(after.includes("Turns lost to freeze")).toBe(runtime.profile.id === "champions");
        }
        if (scenario.carried) {
          const value = scenario.props.value as BattleConditions;
          expect(describeNew(value, scenario.charged ?? {}, scenario.carried)).toBe(describeOld(value, scenario.charged ?? {}, scenario.carried as never));
        }
      });
    }
  }
});
