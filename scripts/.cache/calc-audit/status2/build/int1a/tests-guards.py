# Integration 1a: tests/unit/doubles-turn-guards.test.ts, the guards wave 1a lifted (A1: no L move; D: Opportunist, Mirror
# Herb, Shell Bell's spread heal; W: Focus Band, an ally's priority move; S: a multi-hit move into Disguise; H: Dig's charge).
# Each lifted half now asserts a ready turn; the halves whose guard stays keep their reason.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "tests/unit/doubles-turn-guards.test.ts"
apply([
 (F, '''describe("status moves outside the modelled list", () => {
  it("is not estimated when the move comes before another move; as the last action only the end of turn is not estimated", () => {
    // Gengar (130) uses Skill Swap (status-eot L) first; Charizard's Flamethrower comes after it.
    expectReason(turn(championsRuntime, {
      "own-left": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "opponent-right" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Skill Swap is not modelled and comes before another move.", ["own-right"]);
    // Under Trick Room the fastest Pokémon moves last: no action follows Gengar's Skill Swap.
    const last = calculateDoublesTurn(turn(championsRuntime, {
      "own-left": idle("charizard"), "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "own-left" },
    }, { trickRoom: true }));
    expect(last.status).toBe("ready");
    if (last.status === "ready") expect(last.endOfTurn).toEqual({ status: "not-estimated", reason: "Skill Swap is not modelled." });
  });''', '''describe("status moves outside the modelled list", () => {
  it("none is left (status2): Skill Swap before another move and as the last action are ready", () => {
    // Gengar (130) uses Skill Swap first (status2 A1, kind C); Charizard's Flamethrower comes after it: 26–31 into Blastoise
    // (A1-GRD-1-champions agrees with pinned Showdown).
    const before = calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "opponent-right" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }));
    expect(before.status).toBe("ready");
    if (before.status === "ready") expect(before.steps.find((step) => step.slot === "own-right")!.hits.find((hit) => hit.slot === "opponent-right")).toMatchObject({ min: 26, max: 31 });
    // Under Trick Room the fastest Pokémon moves last: no action follows Gengar's Skill Swap, and the end of turn is followed.
    const last = calculateDoublesTurn(turn(championsRuntime, {
      "own-left": idle("charizard"), "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "own-left" },
    }, { trickRoom: true }));
    expect(last.status).toBe("ready");
    if (last.status === "ready") expect(last.endOfTurn.status).toBe("ready");
  });''', "status moves: none is left"),
 (F, '''    // Aura Sphere sets off Snorlax's Weakness Policy (+2 Atk, +2 Sp. Atk); Espathra's Opportunist copies it.
    expectReason(turn(sv, {
      "own-left": idle("espathra", { ability: "opportunist" }), "own-right": { id: "lucario", ability: "innerfocus", move: "aurasphere", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("snorlax", { item: "weaknesspolicy" }),
    }), "Opportunist copying a stat rise is not modelled in 2v2.", ["own-right"]);
    expectReason(turn(sv, {
      "own-left": idle("garchomp", { item: "mirrorherb" }), "own-right": { id: "lucario", ability: "innerfocus", move: "aurasphere", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("snorlax", { item: "weaknesspolicy" }),
    }), "Mirror Herb copying a stat rise is not modelled in 2v2.", ["own-right"]);''', '''    // Aura Sphere sets off Snorlax's Weakness Policy (+2 Atk, +2 Sp. Atk); Espathra's Opportunist (or Mirror Herb) copies it:
    // modelled (status2 D, G4-OPP cases).
    for (const copier of [idle("espathra", { ability: "opportunist" }), idle("garchomp", { item: "mirrorherb" })]) {
      expect(calculateDoublesTurn(turn(sv, {
        "own-left": copier, "own-right": { id: "lucario", ability: "innerfocus", move: "aurasphere", target: "opponent-right" },
        "opponent-left": idle("venusaur"), "opponent-right": idle("snorlax", { item: "weaknesspolicy" }),
      })).status).toBe("ready");
    }''', "Opportunist and Mirror Herb: modelled"),
 (F, '''  it("Focus Band when a hit into it can knock out, and Max Guard", async () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("dragapult", { item: "focusband", hp: 20 }),
    }), "Focus Band is not modelled.", ["own-left"]);''', '''  it("Focus Band when a hit into it can knock out (modelled: status2 W), and Max Guard", async () => {
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("dragapult", { item: "focusband", hp: 20 }),
    })).status).toBe("ready");''', "Focus Band: modelled"),
 (F, '''  it("a multi-hit move into an intact Disguise", () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "aerodactyl", ability: "pressure", move: "dualwingbeat", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("mimikyu"),
    }), "Disguise against a multi-hit move is not modelled in 2v2.", ["own-left"]);
  });''', '''  it("a multi-hit move into an intact Disguise (modelled: status2 S, T2M §3.13)", () => {
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "aerodactyl", ability: "pressure", move: "dualwingbeat", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("mimikyu"),
    })).status).toBe("ready");
  });''', "multi-hit into Disguise: modelled"),
 (F, '''    expectReason(turn(championsRuntime, {
      "own-left": { id: "charizard", item: "shellbell", hp: 100, move: "heatwave" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Heat Wave heals from more than one target: not modelled.", ["own-left"]);''', '''    // Shell Bell's heal from a spread move's targets: modelled (status2 D, G4-SPH cases).
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "charizard", item: "shellbell", hp: 100, move: "heatwave" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");''', "spread heal: modelled"),
 (F, '''    expectReason(turn(sv, {
      "own-left": { id: "garchomp", move: "dig", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": { id: "venusaur", move: "energyball", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Garchomp is semi-invulnerable after Dig: later moves are not modelled.", ["opponent-left"]);''', '''    // Dig's charge turn: modelled (status2 H, T2M-SI cases).
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "garchomp", move: "dig", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": { id: "venusaur", move: "energyball", target: "own-right" }, "opponent-right": idle("blastoise"),
    })).status).toBe("ready");''', "Dig: modelled"),
 (F, '''  it("Psychic Terrain or the target's own priority shield against its ally's priority move", () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }, { terrain: "Psychic" }), "Psychic Terrain against an ally's move is not modelled.", ["own-left"]);
    expectReason(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("farigiraf", { ability: "armortail" }),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Armor Tail against an ally's move is not modelled.", ["own-left"]);
  });''', '''  it("Psychic Terrain or the target's own priority shield against its ally's priority move (modelled: status2 W)", () => {
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }, { terrain: "Psychic" })).status).toBe("ready");
    expect(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("farigiraf", { ability: "armortail" }),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");
  });''', "ally priority: modelled"),
 (F, '''    const result = expectReason(turn(championsRuntime, {
      "own-left": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "opponent-right" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": { id: "garchomp", move: "earthquake" }, "opponent-right": idle("blastoise"),
    }), "Skill Swap is not modelled and comes before another move.", ["own-right", "opponent-left"]);''', '''    // Revival Blessing (kind P) is never estimated (status2: no L move is left to stand in here).
    const result = expectReason(turn(championsRuntime, {
      "own-left": { id: "pawmot", move: "revivalblessing" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": { id: "garchomp", move: "earthquake" }, "opponent-right": idle("blastoise"),
    }), "Revival Blessing is not modelled.", ["own-right", "opponent-left"]);''', "a not-estimated turn: Revival Blessing"),
])
# Matcha Gotcha's drain from both targets: modelled too (D's drainingStep).
apply([(F, '''    expectReason(turn(sv, {
      "own-left": { id: "sinistcha", ability: "heatproof", hp: 100, move: "matchagotcha" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Matcha Gotcha heals from more than one target: not modelled.", ["own-left"]);''', '''    // Matcha Gotcha's drain from both targets: modelled (status2 D's drainingStep).
    expect(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "sinistcha", ability: "heatproof", hp: 100, move: "matchagotcha" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    })).status).toBe("ready");''', "Matcha Gotcha: modelled")])
