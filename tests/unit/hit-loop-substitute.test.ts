import { describe, expect, it } from "vitest";
import { startHits, subHit, type HitLoopInput } from "@/app/lib/battle/hit-loop";

/**
 * hit-loop.ts subHit (status-eot ADDENDUM §3.6): the attacker through one hit into a Substitute, against pinned Showdown
 * c23d2e94's substitute onTryPrimaryHit (data/moves.ts:18342-18372) and applyRecoilDamage (sim/battle-actions.ts:1379-1398),
 * with the values of the design probes (addendum-probes-3.out U2, U2b, U2c, U2d; critic-probes-1.out K2).
 */
function loop(over: Partial<HitLoopInput> = {}): HitLoopInput {
  return {
    hp: 100, maxHP: 170, baseMaxHP: 170, attackerAbility: "", attackerItem: "", targetAbility: "", targetItem: "",
    attackerShielded: false, targetShielded: false, targetDynamaxed: false, contact: true, category: "Physical",
    drain: null, takesBerry: false, targetGulping: false, generation: 9, ...over,
  };
}
const run = (input: HitLoopInput, taken: number, cost: Parameters<typeof subHit>[3]) => subHit(input, startHits(input), taken, cost);

describe("recoil from the damage the Substitute took (U2)", () => {
  it("Brave Bird into a 30-HP Substitute: round(30 × 33/100) = 10 (153 → 143)", () => {
    const out = run(loop({ hp: 153, maxHP: 153, baseMaxHP: 153 }), 30, { recoil: [33, 100] });
    expect(out.state.hp).toBe(143);
    expect(out.losses).toEqual([{ source: "recoil", amount: 10 }]);
  });
  it("into a 200-HP Substitute from an 81-HP hit: round(81 × 33/100) = 27 (153 → 126)", () => {
    expect(run(loop({ hp: 153, maxHP: 153, baseMaxHP: 153 }), 81, { recoil: [33, 100] }).state.hp).toBe(126);
  });
  it("at least 1, and the recoil can faint the attacker", () => {
    expect(run(loop({ hp: 50 }), 1, { recoil: [1, 4] }).state.hp).toBe(49);
    const out = run(loop({ hp: 5 }), 60, { recoil: [33, 100] });
    expect(out).toMatchObject({ fainted: true, losses: [{ source: "recoil", amount: 5 }] });
  });
  it("none when the Substitute took nothing", () => {
    expect(run(loop(), 0, { recoil: [33, 100] }).state.hp).toBe(100);
  });
});

describe("Steel Beam and Chloroblast: half the maximum HP inside the hit", () => {
  it("round(maxHP / 2), at an odd maximum", () => {
    expect(run(loop({ hp: 139, maxHP: 155 }), 40, { half: "steelbeam" }).state.hp).toBe(139 - 78);
    expect(run(loop({ hp: 139, maxHP: 155 }), 40, { half: "chloroblast" }).state.hp).toBe(139 - 78);
  });
  it("Rock Head stops Chloroblast's (the 'recoil' effect) and recoil, not Steel Beam's (its own condition)", () => {
    const rockHead = loop({ hp: 139, maxHP: 155, attackerAbility: "rockhead" });
    expect(run(rockHead, 40, { half: "chloroblast" }).state.hp).toBe(139);
    expect(run(rockHead, 40, { recoil: [33, 100] }).state.hp).toBe(139);
    expect(run(rockHead, 40, { half: "steelbeam" }).state.hp).toBe(61);
  });
  it("Magic Guard stops each", () => {
    const guarded = loop({ hp: 139, maxHP: 155, attackerAbility: "magicguard" });
    for (const cost of [{ half: "steelbeam" } as const, { half: "chloroblast" } as const, { recoil: [1, 2] as [number, number] }]) {
      expect(run(guarded, 40, cost).state.hp).toBe(139);
    }
  });
});

describe("drain: ceil(taken × drain), not the round of a hit on the Pokémon (U2c)", () => {
  it("Draining Kiss into a 23-HP Substitute heals ceil(23 × 3/4) = 18 (40 → 58); Big Root 23 (→ 63)", () => {
    expect(run(loop({ hp: 40, drain: [3, 4] }), 23, null).state.hp).toBe(58);
    expect(run(loop({ hp: 40, drain: [3, 4], attackerItem: "bigroot" }), 23, null).state.hp).toBe(63);
  });
  it("none at full HP; capped at the maximum", () => {
    expect(run(loop({ hp: 170, drain: [3, 4] }), 23, null).state.hp).toBe(170);
    expect(run(loop({ hp: 160, drain: [3, 4] }), 23, null).state.hp).toBe(170);
  });
  it("the target's Liquid Ooze deals the raw amount instead, with or without Big Root, at full HP too (U2d, K2)", () => {
    const ooze = { drain: [3, 4] as [number, number], targetAbility: "liquidooze" };
    for (const hp of [40, 170]) {
      for (const item of ["", "bigroot"]) {
        const out = run(loop({ hp, attackerItem: item, ...ooze }), 13, null);
        expect(out.state.hp, `${hp} ${item}`).toBe(hp - 10);
        expect(out.losses).toEqual([{ source: "Liquid Ooze", amount: 10 }]);
      }
    }
    expect(run(loop({ hp: 40, attackerAbility: "magicguard", ...ooze }), 13, null).state.hp).toBe(40);
  });
});

describe("the hit's Update and what does not act", () => {
  it("the attacker's HP Berry is eaten at its line after the recoil, a pinch Berry raising its stat", () => {
    const sitrus = run(loop({ hp: 100, maxHP: 160, baseMaxHP: 160, attackerItem: "sitrusberry" }), 90, { recoil: [1, 3] });
    // 100 − 30 = 70 ≤ 80: Sitrus +40.
    expect(sitrus).toMatchObject({ ate: "sitrusberry", state: { hp: 110, attackerItem: "", ate: { item: "sitrusberry", heal: 40, pouch: 0 } } });
    const liechi = run(loop({ hp: 50, maxHP: 160, baseMaxHP: 160, attackerItem: "liechiberry" }), 30, { recoil: [1, 3] });
    expect(liechi).toMatchObject({ ate: "liechiberry", state: { hp: 40, stages: { atk: 1 } } });
    // The target's Unnerve stops it (Berry Juice aside).
    const unnerved = run(loop({ hp: 100, maxHP: 160, baseMaxHP: 160, attackerItem: "sitrusberry", targetAbility: "unnerve" }), 90, { recoil: [1, 3] });
    expect(unnerved).toMatchObject({ ate: null, state: { hp: 70, attackerItem: "sitrusberry" } });
  });
  it("no DamagingHit handler of the target: Rough Skin, Rocky Helmet, a Jaboca Berry, Gulp Missile, Mummy", () => {
    const input = loop({ targetAbility: "roughskin", targetItem: "rockyhelmet", targetGulping: true });
    expect(run(input, 30, null)).toMatchObject({ state: { hp: 100 }, losses: [], fainted: false });
    expect(run(loop({ targetItem: "jabocaberry" }), 30, null).state).toMatchObject({ hp: 100, targetItem: "jabocaberry" });
    expect(run(loop({ targetAbility: "mummy", attackerAbility: "technician" }), 30, null).state.attackerAbility).toBe("technician");
  });
});
