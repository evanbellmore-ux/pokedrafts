import { describe, expect, it } from "vitest";
import { aiCandidates, LIMITS, playerCandidates, type Candidate } from "@/app/(app)/training/ai/candidates";
import { classifySlotAction, situationFeatures } from "@/app/(app)/training/ai/classify";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import type { AiView } from "@/app/(app)/training/model/ai-view";
import { jointActionKey, megaSlots, slotActionKey, withoutMega } from "@/app/(app)/training/model/view-types";
import { keys, makeView, runtime, usageFixture, type MonSpec } from "../fixtures/training-ai";

/** SPEC 10.4 with addendum A1.4 (status moves as candidates) and A1.5 (Mega and non-Mega candidates every turn). */
const whimsicott: MonSpec = { side: "opponent", species: "whimsicott", slot: "opponent-left", moves: ["tailwind", "moonblast", "encore", "protect"], ability: "prankster", item: "focussash", nature: "Timid", points: { hp: 2, spa: 32, spe: 32 } };
const charizard: MonSpec = { side: "opponent", species: "charizard", slot: "opponent-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };
const kingambit: MonSpec = { side: "opponent", species: "kingambit", slot: null, moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } };
const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const incineroar: MonSpec = { side: "own", species: "incineroar", slot: "own-right", moves: ["fakeout", "flareblitz", "partingshot", "protect"], ability: "intimidate", item: "sitrusberry", nature: "Careful", points: { hp: 32, spd: 32 } };

function setup(specs: MonSpec[], options: Parameters<typeof makeView>[1] = {}) {
  const view = makeView(specs, options);
  const rows = damageRows(view, runtime);
  const worth = worthOf(view, rows, runtime);
  const mega = megaOutlook(view, rows, runtime);
  return { view, rows, worth, mega };
}
const usesMove = (candidate: Candidate, moveId: string) => Object.values(candidate.action).some((action) => action?.kind === "move" && action.moveId === moveId);
const legalKeys = (view: AiView, side: "own" | "opponent") => new Set(keys(side === "own" ? view.legal.own : view.legal.opponent));

describe("aiCandidates", () => {
  it("keeps 14 Mega and non-Mega twins on a Mega turn, all legal, never two Megas", () => {
    const { view, rows, worth, mega } = setup([whimsicott, charizard, kingambit, garchomp, { ...incineroar, firstTurn: true }]);
    const candidates = aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega });
    expect(candidates.length).toBeLessThanOrEqual(LIMITS.aiJointMega);
    expect(candidates.length).toBeGreaterThan(LIMITS.aiJoint);
    const legal = legalKeys(view, "opponent");
    const ids = new Set(candidates.map((candidate) => candidate.id));
    for (const candidate of candidates) {
      expect(legal.has(candidate.id)).toBe(true);
      expect(megaSlots(candidate.action).length).toBeLessThanOrEqual(1);
      expect(candidate.base).toBe(jointActionKey(withoutMega(candidate.action)));
      // Every Mega option sits beside its non-Mega twin, so the matrix compares Mega now with keeping it on the same moves.
      if (candidate.mega) expect(ids.has(candidate.base)).toBe(true);
    }
    expect(candidates.some((candidate) => candidate.mega === "opponent-right")).toBe(true);
    expect(candidates.some((candidate) => candidate.mega === null)).toBe(true);
    expect(candidates.map((candidate) => candidate.prior)).toEqual([...candidates.map((candidate) => candidate.prior)].sort((a, b) => b - a));
    // Deterministic.
    expect(aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega })).toEqual(candidates);
  });

  it("never aims Parting Shot, Sleep Powder or an attack at its own partner", () => {
    const aiIncineroar: MonSpec = { ...incineroar, side: "opponent", slot: "opponent-left" };
    const venusaur: MonSpec = { side: "opponent", species: "venusaur", slot: "opponent-right", moves: ["sludgebomb", "earthpower", "sleeppowder", "protect"], ability: "chlorophyll", item: "focussash", nature: "Modest", points: { hp: 4, spa: 32, spe: 30 } };
    const built = setup([aiIncineroar, venusaur, kingambit, garchomp, { ...whimsicott, side: "own", slot: "own-right" }]);
    const { rows, worth, mega } = built;
    // Showdown's request offers them (a "normal" move may target the adjacent ally, PS/sim/battle.ts validTargetLoc).
    const aimed = (joint: AiView["legal"]["opponent"][number], slot: "opponent-left" | "opponent-right", partner: "opponent-left" | "opponent-right") => {
      const action = joint[slot];
      return action?.kind === "move" && action.target && action.target.startsWith("own") ? [{ ...joint, [slot]: { ...action, target: partner } }] : [];
    };
    const extra = built.view.legal.opponent.flatMap((joint) => [...aimed(joint, "opponent-left", "opponent-right"), ...aimed(joint, "opponent-right", "opponent-left")]);
    expect(extra.length).toBeGreaterThan(0);
    const view: AiView = { ...built.view, legal: { ...built.view.legal, opponent: [...built.view.legal.opponent, ...extra] } };
    const intoPartner = (candidate: Candidate) => (["opponent-left", "opponent-right"] as const).some((slot) => {
      const action = candidate.action[slot];
      return action?.kind === "move" && !!action.target && action.target.startsWith("opponent") && action.target !== slot;
    });
    expect(aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega }).filter(intoPartner)).toEqual([]);
  });

  it("keeps 10 on a turn without a Mega, with Protect and a switch", () => {
    const { view, rows, worth, mega } = setup([whimsicott, { ...charizard, canMega: false }, kingambit, garchomp, incineroar]);
    const candidates = aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega });
    expect(candidates).toHaveLength(LIMITS.aiJoint);
    expect(candidates.every((candidate) => candidate.mega === null)).toBe(true);
    expect(candidates.some((candidate) => Object.values(candidate.action).some((action) => action?.kind === "move" && action.moveId === "protect"))).toBe(true);
    expect(candidates.some((candidate) => Object.values(candidate.action).some((action) => action?.kind === "switch"))).toBe(true);
  });

  it("first-chance policy (SPEC Q2, kept for the A1.5 gate): every move of the Mega slot Mega Evolves", () => {
    const { view, rows, worth, mega } = setup([whimsicott, charizard, kingambit, garchomp, incineroar]);
    const candidates = aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega, megaPolicy: "first-chance" });
    expect(candidates.length).toBeLessThanOrEqual(LIMITS.aiJoint);
    for (const candidate of candidates) {
      const action = candidate.action["opponent-right"];
      if (action?.kind === "move") expect(action.mega).toBe("mega");
    }
  });

  it("keeps the slot's status options (A1.4): Tailwind, and a redirector's Rage Powder and Trick Room", () => {
    const { view, rows, worth, mega } = setup([whimsicott, { ...charizard, canMega: false }, kingambit, garchomp, incineroar]);
    const candidates = aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega });
    expect(candidates.some((candidate) => usesMove(candidate, "tailwind"))).toBe(true);
    expect(candidates.some((candidate) => candidate.status)).toBe(true);
    const sinistcha: MonSpec = { side: "opponent", species: "sinistcha", slot: "opponent-left", moves: ["matchagotcha", "ragepowder", "trickroom", "protect"], ability: "hospitality", item: "sitrusberry", nature: "Bold", points: { hp: 32, def: 32 } };
    const torkoal = { ...charizard, canMega: false };
    const support = setup([sinistcha, torkoal, kingambit, garchomp, incineroar]);
    const kept = aiCandidates(support.view, support.rows, support.worth, runtime, { usage: usageFixture, mega: support.mega });
    expect(kept.some((candidate) => usesMove(candidate, "ragepowder") || usesMove(candidate, "trickroom"))).toBe(true);
  });

  it("offers Fake Out only on the first turn and reserves it then", () => {
    const sneasler: MonSpec = { side: "opponent", species: "sneasler", slot: "opponent-left", moves: ["fakeout", "closecombat", "direclaw", "protect"], ability: "unburden", item: "whiteherb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
    const first = setup([{ ...sneasler, firstTurn: true }, { ...charizard, canMega: false }, garchomp, incineroar]);
    expect(aiCandidates(first.view, first.rows, first.worth, runtime, { mega: first.mega }).some((candidate) => usesMove(candidate, "fakeout"))).toBe(true);
    const later = setup([sneasler, { ...charizard, canMega: false }, garchomp, incineroar]);
    expect(aiCandidates(later.view, later.rows, later.worth, runtime, { mega: later.mega }).some((candidate) => usesMove(candidate, "fakeout"))).toBe(false);
  });

  it("weighs a Protect streak down (3^-k)", () => {
    const prior = (streak: number) => {
      const { view, rows, worth, mega } = setup([{ ...whimsicott, protectStreak: streak }, { ...charizard, canMega: false }, kingambit, garchomp, incineroar]);
      const candidates = aiCandidates(view, rows, worth, runtime, { usage: usageFixture, mega, limits: { aiJoint: 200 } });
      return candidates.find((candidate) => candidate.id === "opponent-left=move:protect:-;opponent-right=move:heatwave:-")?.prior ?? null;
    };
    const fresh = prior(0);
    expect(fresh).not.toBeNull();
    // After one success its prior is a third (or below half the slot's best, and pruned); after three it is never kept.
    const once = prior(1);
    expect(once === null || once < fresh!).toBe(true);
    expect(prior(3)).toBeNull();
  });

  it("weighs a Mega form that loses an immunity down (A1.5: types change before this turn's hits)", () => {
    const x: MonSpec = { ...charizard, item: "charizarditex", moves: ["flareblitz", "dragonclaw", "protect"], nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } };
    const quake = { ...garchomp, moves: ["earthquake"] };
    const { view, rows, worth, mega } = setup([{ ...whimsicott, slot: "opponent-left" }, x, quake, { ...incineroar, moves: ["knockoff"] }]);
    const candidates = aiCandidates(view, rows, worth, runtime, { mega, limits: { aiJointMega: 400 } });
    const plain = candidates.find((candidate) => candidate.id === "opponent-left=move:moonblast:own-left;opponent-right=move:dragonclaw:own-left")!;
    const megaTwin = candidates.find((candidate) => candidate.base === plain.id && candidate.mega)!;
    expect(megaTwin).toBeDefined();
    expect(mega["opponent:charizard"].parts.defense).toBeLessThan(0);
    expect(megaTwin.prior).toBeLessThan(plain.prior);
  });
});

describe("playerCandidates", () => {
  it("keeps 6 (top 4 by prior + 2 by habit) with Protect and Fake Out, all legal; SlotContext for every legal action", () => {
    const { view, rows, worth, mega } = setup([whimsicott, { ...charizard, canMega: false }, garchomp, { ...incineroar, firstTurn: true }]);
    const { kept, slots } = playerCandidates(view, rows, worth, null, runtime, { usage: usageFixture, mega });
    expect(kept).toHaveLength(LIMITS.playerJoint);
    const legal = legalKeys(view, "own");
    expect(kept.every((candidate) => legal.has(candidate.id))).toBe(true);
    expect(kept.some((candidate) => usesMove(candidate, "fakeout"))).toBe(true);
    expect(Object.keys(slots).sort()).toEqual(["own-left", "own-right"]);
    for (const slot of ["own-left", "own-right"] as const) {
      const context = slots[slot]!;
      const legalActions = new Set(view.legal.own.map((joint) => slotActionKey(joint[slot]!)));
      expect(new Set(Object.keys(context.classes))).toEqual(legalActions);
      expect(context.canMega).toBe(false);
      expect(context.features).toEqual(situationFeatures(view, rows, slot));
    }
    expect(slots["own-right"]!.classes["move:fakeout:opponent-left"].cls).toBe("fake-out");
    expect(slots["own-right"]!.classes["move:protect:-"].cls).toBe("protect");
    expect(slots["own-left"]!.classes["move:rockslide:-"].cls).toMatch(/^attack-/);
  });

  it("adds the habit model's top options and predicts the player's Mega timing as candidates too", () => {
    const playerMega: MonSpec = { ...charizard, side: "own", slot: "own-left" };
    const { view, rows, worth, mega } = setup([{ ...garchomp, side: "opponent", slot: "opponent-left" }, { ...incineroar, side: "opponent", slot: "opponent-right" }, playerMega, { ...whimsicott, side: "own", slot: "own-right" }]);
    const withoutHabits = playerCandidates(view, rows, worth, null, runtime, { mega });
    expect(withoutHabits.kept.length).toBeLessThanOrEqual(LIMITS.playerJointMega);
    expect(withoutHabits.kept.some((candidate) => candidate.mega === "own-left")).toBe(true);
    expect(withoutHabits.kept.some((candidate) => candidate.mega === null)).toBe(true);
    expect(withoutHabits.slots["own-left"]!.canMega).toBe(true);
    // A habit that strongly favours Encore from Whimsicott and Solar Beam into Garchomp keeps that joint option.
    const habit = { weight: 1, probabilities: { "own-right=move:encore:opponent-left": 0.9, "own-left=move:solarbeam:opponent-left": 0.9 } };
    const withHabits = playerCandidates(view, rows, worth, habit, runtime, { mega });
    expect(withHabits.kept.some((candidate) => candidate.id === "own-left=move:solarbeam:opponent-left;own-right=move:encore:opponent-left")).toBe(true);
  });

  it("labels options with facts", () => {
    const { view, rows, worth, mega } = setup([whimsicott, charizard, garchomp, incineroar]);
    const candidates = aiCandidates(view, rows, worth, runtime, { mega, limits: { aiJointMega: 400 } });
    const labelled = candidates.find((candidate) => candidate.id === "opponent-left=move:moonblast:own-left;opponent-right=move:heatwave:-:mega")!;
    expect(labelled.label).toBe("Whimsicott: Moonblast into Garchomp (" + labelled.label.match(/\((\d+–\d+)%\)/)![1] + "%) · Charizard: Mega Evolution, Heat Wave");
    const action = candidates[0].action["opponent-left"]!;
    expect(classifySlotAction(view, rows, "opponent-left", action, runtime).cls).toBeTruthy();
  });
});
