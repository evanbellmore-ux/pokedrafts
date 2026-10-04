import { describe, expect, it } from "vitest";
import { defaultDoublesTarget, doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTargetRule, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * The choice-time target rule of a move from each slot (SPEC §3.3), mapped from the pinned Showdown move target
 * (sim/side.ts chooseMove, sim/battle-actions.ts targetTypeChoices: normal, any, adjacentAlly, adjacentAllyOrSelf and
 * adjacentFoe take a chosen target). Doubles has one ally, so adjacentAlly is automatic (SPEC C6). Options list the present
 * slots as left foe, right foe, ally, itself; automatic hits list the foes screen-left first, then the ally.
 */
type Slot = { id: string; build?: Partial<BattleBuild>; contexts?: Record<string, MoveContext> } | null;
function input(runtime: BattleRuntime, slots: Partial<Record<DoublesSlotId, Slot>>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const defaults: Record<DoublesSlotId, Slot> = { "own-left": { id: "garchomp" }, "own-right": { id: "charizard" }, "opponent-left": { id: "venusaur" }, "opponent-right": { id: "blastoise" } };
  const pokemon = Object.fromEntries((Object.keys(defaults) as DoublesSlotId[]).map((slot) => {
    const entry = slot in slots ? slots[slot]! : defaults[slot];
    if (!entry) return [slot, null];
    const value: DoublesPokemonInput = {
      build: { ...createBuild(entry.id, runtime), ...entry.build } as BattleBuild,
      contexts: entry.contexts ?? {}, charged: false, action: { moveId: null, target: null },
    };
    return [slot, value];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const rule = (turn: DoublesTurnInput, slot: DoublesSlotId, moveId: string) => doublesTargetRule(turn, slot, moveId);

describe("doublesTargetRule: the dex target from each slot", () => {
  const turn = input(championsRuntime, { "own-left": { id: "garchomp" }, "own-right": { id: "charizard" }, "opponent-left": { id: "malamar" }, "opponent-right": { id: "blastoise" } });

  it("lets a single-target move choose any adjacent Pokémon: both foes, then the ally", () => {
    // normal (Flamethrower, Dragon Claw) and any (Air Slash): side.ts validTargetLoc allows the ally, never the user.
    expect(rule(turn, "own-right", "flamethrower")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-left"] });
    expect(rule(turn, "own-left", "dragonclaw")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] });
    expect(rule(turn, "own-right", "airslash")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-left"] });
    // From the far side the foes are your left and right Pokémon, screen-left first.
    expect(rule(turn, "opponent-left", "psychocut")).toEqual({ kind: "choose", options: ["own-left", "own-right", "opponent-right"] });
  });

  it("makes spread and random-target moves automatic", () => {
    expect(rule(turn, "own-left", "rockslide")).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right"] });
    expect(rule(turn, "own-left", "earthquake")).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right", "own-right"] });
    expect(rule(turn, "own-left", "outrage")).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right"], random: true });
    expect(rule(turn, "own-right", "helpinghand")).toEqual({ kind: "auto", hits: ["own-left"] });
  });

  it("lets an ally-or-self move choose between the ally and the user", () => {
    expect(rule(turn, "opponent-left", "acupressure")).toEqual({ kind: "choose", options: ["opponent-right", "opponent-left"] });
  });

  it("gives every no-target move its scope", () => {
    const cases: [DoublesSlotId, string, DoublesTargetRule][] = [
      ["own-left", "protect", { kind: "none", scope: "self" }],
      ["own-left", "swordsdance", { kind: "none", scope: "self" }],
      ["opponent-right", "lifedew", { kind: "none", scope: "self-and-ally" }],
      ["own-right", "tailwind", { kind: "none", scope: "own-side" }],
      ["own-left", "stealthrock", { kind: "none", scope: "foe-side" }],
      ["own-left", "trickroom", { kind: "none", scope: "field" }],
      ["own-left", "sandstorm", { kind: "none", scope: "field" }],
      ["own-left", "counter", { kind: "none", scope: "last-attacker" }],
    ];
    for (const [slot, moveId, expected] of cases) expect(rule(turn, slot, moveId), moveId).toEqual(expected);
    // allyTeam: Heal Bell.
    const chimecho = input(championsRuntime, { "own-left": { id: "chimecho" } });
    expect(rule(chimecho, "own-left", "healbell")).toEqual({ kind: "none", scope: "own-team" });
  });

  it("asks Expanding Force and Tera Starstorm for one target, as the game does at choice time", async () => {
    const psychic = input(championsRuntime, { "own-left": { id: "gardevoir" } }, { terrain: "Psychic" });
    expect(rule(psychic, "own-left", "expandingforce")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] });
    const sv = await loadBattleRuntime("scarlet_violet");
    const stellar = input(sv, { "own-left": { id: "terapagos", build: { mechanic: "tera", configuration: { teraType: "Stellar" } } } });
    expect(rule(stellar, "own-left", "terastarstorm")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] });
  });

  it("lists only the slots with a Pokémon", () => {
    const lone = input(championsRuntime, { "own-right": null, "opponent-left": null });
    expect(rule(lone, "own-left", "dragonclaw")).toEqual({ kind: "choose", options: ["opponent-right"] });
    expect(rule(lone, "own-left", "earthquake")).toEqual({ kind: "auto", hits: ["opponent-right"] });
    expect(rule(lone, "own-left", "rockslide")).toEqual({ kind: "auto", hits: ["opponent-right"] });
  });
});

describe("doublesTargetRule: Z-Moves and Max Moves use the converted move's target", () => {
  it("turns a damaging move into a single-target Z-Move (target normal)", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Tectonic Rage is normal: Earthquake's spread becomes a chosen target with the Z-Crystal and useZ.
    const z = input(usum, { "own-left": { id: "garchomp", build: { itemId: "groundiumz" }, contexts: { earthquake: { useZ: true } } } });
    expect(doublesTargetRule(z, "own-left", "earthquake")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] });
    // Without useZ it stays the spread move.
    const plain = input(usum, { "own-left": { id: "garchomp", build: { itemId: "groundiumz" } } });
    expect(doublesTargetRule(plain, "own-left", "earthquake")).toEqual({ kind: "auto", hits: ["opponent-left", "opponent-right", "own-right"] });
  });

  it("turns a damaging move into a Max Move into one foe, and a status move into Max Guard", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const max = input(swsh, { "own-right": { id: "charizard", build: { mechanic: "dynamax" } } });
    // Max Flare is adjacentFoe: the foes only, even from a spread move.
    expect(doublesTargetRule(max, "own-right", "heatwave")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right"] });
    expect(doublesTargetRule(max, "own-right", "flamethrower")).toEqual({ kind: "choose", options: ["opponent-left", "opponent-right"] });
    expect(doublesTargetRule(max, "own-right", "protect")).toEqual({ kind: "none", scope: "self" });
  });
});

describe("defaultDoublesTarget", () => {
  const choose: DoublesTargetRule = { kind: "choose", options: ["opponent-left", "opponent-right", "own-right"] };

  it("keeps the current target when it is an option, else the preferred one, else the first option", () => {
    expect(defaultDoublesTarget(choose, "opponent-right", "opponent-left")).toBe("opponent-right");
    expect(defaultDoublesTarget(choose, "own-left", "own-right")).toBe("own-right");
    expect(defaultDoublesTarget(choose, null, "opponent-right")).toBe("opponent-right");
    expect(defaultDoublesTarget(choose, "own-left", "own-left")).toBe("opponent-left");
    expect(defaultDoublesTarget(choose, null, null)).toBe("opponent-left");
  });

  it("has no target for automatic and no-target rules", () => {
    expect(defaultDoublesTarget({ kind: "auto", hits: ["opponent-left", "opponent-right"] }, "opponent-left", "opponent-left")).toBeNull();
    expect(defaultDoublesTarget({ kind: "none", scope: "self" }, "opponent-left", null)).toBeNull();
  });
});
