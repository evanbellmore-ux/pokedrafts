// Proposed tests/unit/calculator-shell-side-arm.test.ts. Every number is from real pinned Showdown
// c23d2e94 battles with the tie coin forced each way (audit oos/ssa-tie/testdata.ts, testdata2.ts, fixed-check2.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { previewRemainingHP } from "@/app/(app)/calculator/hp-preview";
import MatchupSummary from "@/app/(app)/calculator/MatchupSummary";
import MoveResults, { MoveDetails } from "@/app/(app)/calculator/MoveResults";
import { createMatchup, getAttackView, selectMatchupMove, updateMatchupBuild } from "@/app/(app)/calculator/roster-prep";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, SideConditions, StatTable } from "@/app/lib/battle/types";

let sv: BattleRuntime;
let ss: BattleRuntime;
beforeAll(async () => {
  [sv, ss] = await Promise.all([loadBattleRuntime("scarlet_violet"), loadBattleRuntime("sword_shield")]);
});

type Spec = Partial<Pick<BattleBuild, "abilityId" | "itemId" | "nature" | "status" | "currentHP" | "mechanic">> & {
  evs?: Partial<StatTable<number>>; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>; level?: number;
};
/** Level 50, 31 IVs, Serious nature unless set. */
function build(runtime: BattleRuntime, id: string, { evs, boosts, level, ...rest }: Spec = {}): BattleBuild {
  const base = createBuild(id, runtime);
  const out = { ...base, ...rest, boosts: { ...base.boosts, ...boosts } } as BattleBuild;
  if (out.game === "champions") return { ...out, points: { ...out.points, ...evs } } as BattleBuild;
  return { ...out, native: { ...out.native, evs: { ...out.native.evs, ...evs }, ...(level ? { level } : {}) } } as BattleBuild;
}
const slowbro = (runtime: BattleRuntime, spec: Spec = {}) => build(runtime, "slowbrogalar", { abilityId: "regenerator", ...spec });
function row(runtime: BattleRuntime, attacker: BattleBuild, defender: BattleBuild, field: Omit<Partial<BattleConditions>, "defenderSide"> & { defenderSide?: Partial<SideConditions> } = {}) {
  const base = createConditions();
  const conditions = { ...base, gameType: "Singles", ...field, defenderSide: { ...base.defenderSide, ...field.defenderSide } } as BattleConditions;
  const out = calculateMatchup(attacker, defender, conditions, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === "shellsidearm")!;
}
const TIE = "Shell Side Arm: tied";
const SPECIAL_51 = [51, 52, 52, 54, 54, 54, 55, 55, 57, 57, 57, 58, 58, 60, 60, 61];
const AV_34 = [34, 36, 36, 36, 36, 37, 37, 37, 39, 39, 39, 39, 40, 40, 40, 42];
const HALF_25 = [25, 26, 26, 27, 27, 27, 27, 27, 28, 28, 28, 29, 29, 30, 30, 30];
const EISCUE_48 = [48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54, 54, 54, 55, 55, 57];

describe("Shell Side Arm ties", () => {
  it("keeps one row when both categories deal the same damage", () => {
    // Atk = Sp. Atk = 120 into Def = Sp. Def = 120 (exact tie), and Sp. Def 121 (floored tie the engine calls physical).
    for (const mew of [build(sv, "mew"), build(sv, "mew", { evs: { spd: 4 } })]) {
      const result = row(sv, slowbro(sv), mew);
      expect(result).toMatchObject({ kind: "calculated", min: 51, max: 61, rolls: SPECIAL_51, effectiveCategory: "Special", ohkoChance: 0 });
      expect(result.alternate).toBeUndefined();
      expect(result.assumptions).toContain(`${TIE}, so physical or special at random (50% each), same damage; only the physical hit makes contact.`);
    }
  });

  it("shows the physical hit as a 50% alternate when it deals different damage", () => {
    for (const evs of [{}, { spd: 4 }]) {
      const result = row(sv, slowbro(sv), build(sv, "mew", { itemId: "assaultvest", evs }));
      expect(result).toMatchObject({ min: 34, max: 42, rolls: AV_34, effectiveCategory: "Special", ohkoChance: 0,
        alternate: { chance: 0.5, label: "a physical hit", usualLabel: "special hit", min: 51, max: 61, rolls: SPECIAL_51 } });
      expect(result.description).toBe("Shell Side Arm: 34–42 HP (19.4–24.0% of maximum HP), or 51–61 HP (29.1–34.9%) when it is physical (50% chance). Applied to the special hit: Assault Vest.");
    }
    // At 55 HP no special roll KOs and 10 of 16 physical rolls do: 0.5 × 10/16.
    expect(row(sv, slowbro(sv), build(sv, "mew", { itemId: "assaultvest", evs: { spd: 4 }, currentHP: 55 })).ohkoChance).toBeCloseTo(0.3125, 10);
    // Sword/Shield, Doubles and Tera match too.
    expect(row(ss, slowbro(ss), build(ss, "mew", { itemId: "assaultvest", evs: { spd: 4 } }))).toMatchObject({ rolls: AV_34, alternate: { rolls: SPECIAL_51 } });
    expect(row(sv, slowbro(sv), build(sv, "mew", { itemId: "assaultvest", evs: { spd: 4 } }), { gameType: "Doubles" })).toMatchObject({ rolls: AV_34, alternate: { rolls: SPECIAL_51 } });
    const tera = { ...slowbro(sv), mechanic: "tera", configuration: { teraType: "Poison" } } as BattleBuild;
    expect(row(sv, tera, build(sv, "mew", { itemId: "assaultvest", evs: { spd: 4 } }))).toMatchObject({ min: 46, max: 56, alternate: { min: 68, max: 82 } });
  });

  it("weighs the effects Showdown's estimate leaves out", () => {
    const mew = build(sv, "mew", { evs: { spd: 4 } });
    // A burn or Reflect halves the physical hit, Light Screen the special one.
    expect(row(sv, slowbro(sv, { status: "brn" }), mew)).toMatchObject({ rolls: SPECIAL_51, alternate: { rolls: HALF_25 } });
    expect(row(sv, slowbro(sv), mew, { defenderSide: { reflect: true } })).toMatchObject({ rolls: SPECIAL_51, alternate: { rolls: HALF_25 } });
    expect(row(sv, slowbro(sv), mew, { defenderSide: { lightScreen: true } })).toMatchObject({ rolls: HALF_25, alternate: { rolls: SPECIAL_51 } });
    // A critical hit ignores the -1 Attack the estimate counted.
    expect(row(sv, slowbro(sv, { boosts: { atk: -1 } }), build(sv, "mew", { nature: "Gentle", evs: { spd: 196 } }), { critical: true }))
      .toMatchObject({ min: 58, max: 69, alternate: { min: 87, max: 103 } });
    // Wonder Room: the estimate keeps each stored defense (with the other one's stage); the hits swap them.
    expect(row(sv, slowbro(sv, { nature: "Quiet", evs: { spa: 252 } }), build(sv, "mew", { nature: "Calm", evs: { spd: 244 } }), { wonderRoom: true }))
      .toMatchObject({ min: 72, max: 85, alternate: { rolls: [37, 37, 39, 39, 39, 40, 40, 40, 40, 42, 42, 42, 43, 43, 43, 45] } });
    // Under Wonder Room with a stage, only Showdown's rule ties: stored Def 129 with the Sp. Def stage (0) against
    // stored Sp. Def 120 with the Def stage (+1, 180); the hits then use the swapped defenses.
    expect(row(sv, slowbro(sv, { nature: "Quiet", evs: { spa: 252 } }), build(sv, "mew", { itemId: "assaultvest", evs: { def: 68 }, boosts: { def: 1 } }), { wonderRoom: true }))
      .toMatchObject({ rolls: [45, 45, 46, 46, 48, 48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54], alternate: { rolls: AV_34 } });
    // Vessel of Ruin lowers only the special hit (a stat modifier, outside the estimate).
    expect(row(sv, slowbro(sv), build(sv, "tinglu", { abilityId: "vesselofruin", nature: "Calm", evs: { spd: 252 } })))
      .toMatchObject({ rolls: [16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 19], alternate: { rolls: [21, 21, 21, 21, 22, 22, 22, 23, 23, 23, 24, 24, 24, 24, 24, 25] } });
    // Fluffy halves the physical hit, which makes contact.
    const fluffy = row(ss, slowbro(ss), build(ss, "bewear", { abilityId: "fluffy", evs: { spd: 156 } }));
    expect(fluffy).toMatchObject({ min: 61, max: 73, alternate: { min: 30, max: 36 } });
    expect(fluffy.description).toBe("Shell Side Arm: 61–73 HP (31.3–37.4% of maximum HP), or 30–36 HP (15.4–18.5%) when it is physical (50% chance). Applied to the physical hit: Fluffy.");
  });

  it("uses the attacker's level in the estimate and weighs a physical KO", () => {
    // Level 100 into level 50: 42 × 90 × 236 / 150 and / 151 both floor to 118 (at level 50's factor 22 they would not tie).
    for (const runtime of [sv, ss]) {
      const result = row(runtime, slowbro(runtime, { level: 100 }), build(runtime, "mew", { itemId: "assaultvest", evs: { def: 236, spd: 244 } }));
      expect(result).toMatchObject({ rolls: [102, 102, 103, 105, 106, 108, 108, 109, 111, 112, 114, 114, 115, 117, 118, 120],
        alternate: { rolls: [153, 154, 156, 157, 159, 162, 163, 165, 166, 168, 171, 172, 174, 175, 177, 180] } });
      // 3 of 16 physical rolls KO the 175 HP target, no special roll does: 0.5 × 3/16.
      expect(result.ohkoChance).toBeCloseTo(0.09375, 10);
    }
  });

  it("lets an intact Ice Face block the physical half", () => {
    // Def = Sp. Def = 130 (exact tie; the app showed only the special hit) and Sp. Def 131 (the engine calls it physical; the row was withheld).
    for (const [runtime, spd] of [[ss, 160], [sv, 160], [sv, 168]] as const) {
      const result = row(runtime, slowbro(runtime), build(runtime, "eiscue", { abilityId: "iceface", evs: { spd } }));
      expect(result).toMatchObject({ kind: "calculated", min: 48, max: 57, rolls: EISCUE_48, effectiveCategory: "Special", ohkoChance: 0,
        alternate: { chance: 0.5, label: "a physical hit, which Ice Face blocks", min: 0, max: 0, rolls: Array(16).fill(0) } });
      expect(result.description).toBe("Shell Side Arm: 48–57 HP (32.0–38.0% of maximum HP), or no damage when it is physical and Ice Face blocks it (50% chance).");
    }
    // At 50 HP, 11 of 16 special rolls KO: 0.5 × 11/16.
    expect(row(sv, slowbro(sv), build(sv, "eiscue", { abilityId: "iceface", evs: { spd: 168 }, currentHP: 50 })).ohkoChance).toBeCloseTo(0.34375, 10);
    // Off a tie a physical Shell Side Arm still waits for Eiscue-Noice.
    expect(row(sv, slowbro(sv, { nature: "Adamant", evs: { atk: 252 } }), build(sv, "eiscue", { abilityId: "iceface" })).kind).toBe("needs-context");
  });

  it("changes nothing off a tie, for Max Ooze or into an immune target", () => {
    const quiet = row(sv, slowbro(sv, { nature: "Quiet", evs: { spa: 252 } }), build(sv, "mew"));
    expect(quiet).toMatchObject({ min: 72, max: 85, effectiveCategory: "Special" });
    expect(quiet.alternate).toBeUndefined();
    expect(quiet.assumptions.some((line) => line.startsWith(TIE))).toBe(false);
    expect(row(sv, slowbro(sv, { nature: "Brave", evs: { atk: 252 } }), build(sv, "mew", { itemId: "assaultvest" }))).toMatchObject({ min: 72, max: 85, effectiveCategory: "Physical" });
    // Max Ooze keeps the base move's special category (no coin in Showdown).
    const maxOoze = row(ss, slowbro(ss, { mechanic: "dynamax" }), build(ss, "mew", { itemId: "assaultvest", evs: { spd: 4 } }));
    expect(maxOoze).toMatchObject({ min: 34, max: 42, rolls: AV_34 });
    expect(maxOoze.alternate).toBeUndefined();
    const steel = row(sv, slowbro(sv), build(sv, "registeel"));
    expect(steel).toMatchObject({ min: 0, max: 0 });
    expect(steel.alternate).toBeUndefined();
  });

  it("matches Champions", () => {
    const hydreigon = build(championsRuntime, "hydreigon", { evs: { def: 1, spd: 2 } });
    const burned = row(championsRuntime, build(championsRuntime, "slowbrogalar", { abilityId: "regenerator", status: "brn" }), hydreigon);
    expect(burned).toMatchObject({ rolls: [55, 55, 57, 57, 58, 58, 60, 60, 60, 61, 61, 63, 63, 64, 64, 66], alternate: { rolls: [27, 27, 28, 28, 29, 29, 30, 30, 30, 30, 30, 31, 31, 32, 32, 33] } });
    expect(row(championsRuntime, build(championsRuntime, "slowbrogalar", { abilityId: "regenerator" }), hydreigon, { defenderSide: { lightScreen: true } }))
      .toMatchObject({ min: 27, max: 33, alternate: { min: 55, max: 66 } });
  });

  it("shows both hits in the results, details, summary and HP preview", () => {
    const attacker = build(championsRuntime, "slowbrogalar", { abilityId: "regenerator", status: "brn" });
    const hydreigon = build(championsRuntime, "hydreigon", { evs: { def: 1, spd: 2 } });
    const tie = row(championsRuntime, attacker, hydreigon);
    const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(renderToStaticMarkup(createElement(MoveResults, {
      rows: [tie], moveIds: ["shellsidearm"], ownerId: "0:0", selectedMoveId: null, onSelectMove: vi.fn(), contexts: {},
      onContextChange: vi.fn(), abilityId: "regenerator", itemId: "", attackerName: "Slowbro", defenderName: "Hydreigon", defenderHP: 167,
    }))).toContain("50% chance of a physical hit: 27–33 HP (16.17–19.76% of max HP)");
    const details = renderToStaticMarkup(createElement(MoveDetails, { moveId: "shellsidearm", row: tie, id: "d", context: {}, abilityId: "regenerator", itemId: "", onContextChange: vi.fn() }));
    expect(details).toContain("Damage rolls (special hit): 55,");
    expect(details).toContain("Damage rolls with a physical hit (50% chance): 27,");
    let matchup = createMatchup(0, championsRuntime);
    matchup = updateMatchupBuild(matchup, "attacker", attacker);
    matchup = updateMatchupBuild(matchup, "defender", hydreigon);
    matchup = selectMatchupMove(matchup, "shellsidearm");
    const view = getAttackView(matchup);
    const summary = text(renderToStaticMarkup(createElement(MatchupSummary, {
      attacker: matchup.attacker, defender: matchup.defender, attack: matchup.attack, replacement: matchup.replacement,
      resultIdentity: { source: view.owner, receiver: view.receiverOwner }, selectedRow: tie, rollMode: "low",
      issues: { attacker: [], defender: [] }, movesControl: "moves", onBuildChange: vi.fn(), onHPChange: vi.fn(), onRosterSelect: vi.fn(), onShowMove: vi.fn(),
      onRollModeChange: vi.fn(), onActivateMove: vi.fn(), onToggleMega: vi.fn(), runtime: championsRuntime,
    })));
    expect(summary).toContain("55–66 damage range, or 27–33 with a physical hit (50% chance) · One-use KO: 0% (all rolls, both cases)");
    expect(summary).toContain("Hydreigon HP remaining: 112 / 167 With a physical hit (50% chance, same Low roll): 27 damage, 140 / 167 HP remaining.");
    expect(previewRemainingHP(hydreigon, tie, "low")).toMatchObject({ damage: 55, remaining: 112, alternate: { chance: 0.5, damage: 27, remaining: 140 } });
  });
});
