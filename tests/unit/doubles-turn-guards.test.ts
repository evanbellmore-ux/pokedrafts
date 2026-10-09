import { describe, expect, it } from "vitest";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";

/**
 * Every "not estimated" row of SPEC §2.2 with its exact reason text. A turn that meets one is "not-estimated" as a whole, and
 * still lists each damaging move's damage at the start of the turn (startRows), except where the guard is the start itself
 * (Imposter, Commander, Trace, Download, a Starf Berry, two Pokémon acting on one): no start row is exact there, so none is
 * required. Neutralizing Gas is modelled from the turn's start (calculator-ngas-2v2.test.ts has its guards). Presence rows trigger when the Pokémon or move is in the turn; event rows only when the event
 * happens on some branch. Level 50, 0 EVs / Stat Points, Serious nature.
 */
type P = {
  id: string; ability?: string; item?: string; nature?: string; hp?: number; status?: BattleStatus;
  move?: string | null; target?: DoublesSlotId; contexts?: Record<string, MoveContext>; build?: Partial<BattleBuild>; charged?: boolean;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
function turn(runtime: BattleRuntime, slots: Record<DoublesSlotId, P | null>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = {
      ...base, nature: p.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId),
      itemId: p.item ?? base.itemId, currentHP: p.hp ?? null, status: p.status ?? "", ...p.build,
    } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: p.contexts ?? {}, charged: !!p.charged, action: { moveId: p.move ?? null, target: p.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = { champions: championsRuntime };
async function game(id: BattleGame) {
  return runtimes[id] ??= await loadBattleRuntime(id);
}
/** The result is not estimated with this reason (one of these, where the SPEC leaves an order open), and start rows for `rows`. */
function expectReason(input: DoublesTurnInput, reason: string | string[], rows: DoublesSlotId[] = []): DoublesTurnResult {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "issues" ? result.issues : result.status === "ready" ? result.facts : result.reason)).toBe("not-estimated");
  if (result.status !== "not-estimated") return result;
  expect(Array.isArray(reason) ? reason : [reason]).toContain(result.reason);
  for (const slot of rows) expect(result.startRows.some((row) => row.slot === slot), `start row for ${slot}`).toBe(true);
  return result;
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });

describe("status moves outside the modelled list", () => {
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
  });

  it("models the status moves that change HP wherever they come; Revival Blessing stays not estimated", async () => {
    const hpMoves: [string, string, string | undefined][] = [["dragonite", "roost", undefined], ["gengar", "substitute", undefined], ["azumarill", "bellydrum", undefined], ["gengar", "painsplit", "own-left"]];
    for (const [id, move, target] of hpMoves) {
      const result = calculateDoublesTurn(turn(championsRuntime, {
        "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
        "opponent-left": idle("venusaur"), "opponent-right": { id, move, ...(target ? { target: target as DoublesSlotId } : {}) },
      }));
      expect(result.status, move).toBe("ready");
    }
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": { id: "pawmot", move: "revivalblessing" },
    }), "Revival Blessing is not modelled.", ["own-left"]);
  });

  it("heals the user's ally with Pollen Puff (half its maximum HP; it fails at full HP)", () => {
    const puff = (hp?: number) => calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "vivillon", ability: "shielddust", move: "pollenpuff", target: "own-right" }, "own-right": idle("charizard", hp === undefined ? {} : { hp }),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }));
    const full = puff();
    expect(full.status).toBe("ready");
    if (full.status !== "ready") return;
    const fullHit = full.steps[0].hits.find((hit) => hit.slot === "own-right")!;
    expect(fullHit.facts.map((fact) => fact.text)).toEqual(["Pollen Puff fails: Charizard is at full HP."]);
    const half = puff(50);
    expect(half.status).toBe("ready");
    if (half.status !== "ready") return;
    expect(half.steps[0].hits.find((hit) => hit.slot === "own-right")!.change).toEqual({ min: 76, max: 76 });
  });
});

describe("moves and abilities that are out in 2v2 (presence)", () => {
  it("names each move not modelled in 2v2", async () => {
    const rows: [BattleGame, string, string, DoublesSlotId | undefined][] = [
      ["champions", "weavile", "beatup", "opponent-right"], ["champions", "clefable", "round", "opponent-right"],
      ["scarlet_violet", "toucannon", "beakblast", "opponent-right"], ["scarlet_violet", "zekrom", "fusionbolt", "opponent-right"],
      ["scarlet_violet", "reshiram", "fusionflare", "opponent-right"], ["ultra_sun_ultra_moon", "clefairy", "spotlight", "opponent-right"],
      ["ultra_sun_ultra_moon", "turtonator", "shelltrap", undefined], ["champions", "snorlax", "counter", undefined],
    ];
    for (const [g, id, move, target] of rows) {
      const runtime = await game(g);
      expectReason(turn(runtime, {
        "own-left": { id, move, ...(target ? { target } : {}) }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
        "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
      }), `${runtime.movesById.get(move)!.name} is not modelled in 2v2.`, ["own-right"]);
    }
  });

  it("names Imposter and Commander with Dondozo on its side; Neutralizing Gas is modelled", async () => {
    const sv = await game("scarlet_violet");
    const base = { "opponent-left": idle("venusaur"), "opponent-right": { id: "garchomp", move: "dragonclaw", target: "own-left" as const } };
    // Dragon Claw has no effect on Fairy-type Weezing-Galar: the gas stays, so the turn is estimated (ngas-pp N1).
    expect(calculateDoublesTurn(turn(sv, { "own-left": idle("weezinggalar", { ability: "neutralizinggas" }), "own-right": idle("charizard"), ...base })).status).toBe("ready");
    expectReason(turn(sv, { "own-left": idle("ditto", { ability: "imposter" }), "own-right": idle("charizard"), ...base }), "Imposter is not modelled in 2v2.");
    expectReason(turn(sv, { "own-left": idle("tatsugiri", { ability: "commander" }), "own-right": idle("dondozo", { ability: "unaware" }), ...base }), "Commander is not modelled in 2v2.");
    // Commander with no Dondozo on its side does nothing in 2v2.
    expect(calculateDoublesTurn(turn(sv, { "own-left": idle("tatsugiri", { ability: "commander" }), "own-right": idle("charizard"), ...base })).status).toBe("ready");
  });
});

describe("events that are out in v1", () => {
  it("Dancer when a dance move is used", async () => {
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": idle("oricorio", { ability: "dancer" }), "own-right": idle("snorlax"),
      "opponent-left": { id: "volcarona", ability: "flamebody", move: "fierydance", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Dancer is not modelled.", ["opponent-left"]);
  });

  it("Battery, Power Spot and Steely Spirit on the attacker's partner are modelled (doubles-start-rows.test.ts; Flower Gift: doubles-turn-fixes)", async () => {
    const sv = await game("scarlet_violet");
    const swsh = await game("sword_shield");
    // The hit into Blastoise with the partner's power boost, as pinned Showdown deals it (data/abilities.ts onAllyBasePower;
    // the start-rows oracle cases SRG1-SRG3 of scripts/.cache/calc-audit/startrows/fix/cases-sr.ts).
    const hit = (input: DoublesTurnInput) => {
      const result = calculateDoublesTurn(input);
      expect(result.status).toBe("ready");
      const found = result.status === "ready" ? result.steps.find((step) => step.slot === "own-right")?.hits.find((each) => each.slot === "opponent-right") : undefined;
      return found && { kind: found.kind, min: found.min, max: found.max };
    };
    expect(hit(turn(sv, {
      "own-left": idle("charjabug"), "own-right": { id: "vikavolt", move: "thunderbolt", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }))).toEqual({ kind: "calculated", min: 174, max: 206 });
    expect(hit(turn(swsh, {
      "own-left": idle("stonjourner"), "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }))).toEqual({ kind: "calculated", min: 34, max: 41 });
    expect(hit(turn(swsh, {
      "own-left": idle("perrserker", { ability: "steelyspirit" }), "own-right": { id: "zamazenta", move: "ironhead", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }))).toEqual({ kind: "calculated", min: 28, max: 34 });
  });

  it("Trace with a random source or copying Intimidate; Download with a foe's entry boost", async () => {
    // Trace unset: the foes' copyable abilities differ (Overgrow, Torrent).
    expectReason(turn(championsRuntime, {
      "own-left": idle("gardevoir", { ability: "trace" }), "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
      "opponent-left": idle("venusaur", { ability: "overgrow" }), "opponent-right": idle("blastoise", { ability: "torrent" }),
    }), "Trace copies a random foe's ability.");
    expectReason(turn(championsRuntime, {
      "own-left": idle("gardevoir", { ability: "trace", build: { tracedAbility: "intimidate" } }), "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-left" },
      "opponent-left": idle("incineroar", { ability: "intimidate" }), "opponent-right": idle("blastoise"),
    }), "Trace copying Intimidate is not modelled in 2v2.");
    const swsh = await game("sword_shield");
    expectReason(turn(swsh, {
      "own-left": { id: "porygon2", ability: "download", move: "triattack", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("zamazenta", { ability: "dauntlessshield" }),
    }), "Download is not modelled with Zamazenta's entry boost.");
  });

  it("a Starf Berry eaten as the turn starts, and Opportunist copying a rise", async () => {
    const sv = await game("scarlet_violet");
    // 40/183 is at or under a quarter: the Starf Berry is eaten at the turn's first Update.
    expectReason(turn(sv, {
      "own-left": { id: "garchomp", item: "starfberry", hp: 40, move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Starf Berry raises a random stat");
    // Aura Sphere sets off Snorlax's Weakness Policy (+2 Atk, +2 Sp. Atk); Espathra's Opportunist copies it.
    expectReason(turn(sv, {
      "own-left": idle("espathra", { ability: "opportunist" }), "own-right": { id: "lucario", ability: "innerfocus", move: "aurasphere", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("snorlax", { item: "weaknesspolicy" }),
    }), "Opportunist copying a stat rise is not modelled in 2v2.", ["own-right"]);
    expectReason(turn(sv, {
      "own-left": idle("garchomp", { item: "mirrorherb" }), "own-right": { id: "lucario", ability: "innerfocus", move: "aurasphere", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("snorlax", { item: "weaknesspolicy" }),
    }), "Mirror Herb copying a stat rise is not modelled in 2v2.", ["own-right"]);
  });

  it("two Pokémon acting on one as the turn starts", async () => {
    // Tyranitar's Unnerve keeps Flutter Mane's Sitrus Berry (50/130) uneaten; Altaria's Cloud Nine keeps the sun from its Protosynthesis.
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "fluttermane", item: "sitrusberry", hp: 50, move: "moonblast", target: "opponent-left" }, "own-right": idle("charizard"),
      "opponent-left": idle("tyranitar", { ability: "unnerve" }), "opponent-right": idle("altaria", { ability: "cloudnine" }),
    }, { weather: "Sun" }), ["Tyranitar and Altaria both act on Flutter Mane as the turn starts.", "Altaria and Tyranitar both act on Flutter Mane as the turn starts."]);
  });

  it("sleep, freeze and confusion on a Pokémon with a move are modelled (status-eot SPEC §4.2)", async () => {
    const base = { "own-right": idle("charizard"), "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise") };
    // Champions sleep {2: 1/3, 3: 2/3}: no wake at its first BeforeMove; with no carried count, a turn fact.
    const asleep = calculateDoublesTurn(turn(championsRuntime, { "own-left": { id: "garchomp", status: "slp", move: "dragonclaw", target: "opponent-right" }, ...base }));
    expect(asleep.status).toBe("ready");
    if (asleep.status !== "ready") return;
    expect(asleep.steps[0].skipped).toEqual([{ text: "Asleep.", chance: 1 }]);
    expect(asleep.facts).toContain("Assumes Garchomp lost no turns to sleep before this one.");
    // Champions freeze: it thaws with 1/4 at its first BeforeMove.
    const frozen = calculateDoublesTurn(turn(championsRuntime, { "own-left": { id: "garchomp", status: "frz", move: "dragonclaw", target: "opponent-right" }, ...base }));
    expect(frozen.status).toBe("ready");
    if (frozen.status !== "ready") return;
    expect(frozen.steps[0].skipped).toEqual([{ text: "Frozen.", chance: 0.75 }]);
    expect(frozen.steps[0].facts).toContainEqual({ text: "Thaws.", chance: 0.25 });
    // A sleeping Pokémon with No move is fine.
    expect(calculateDoublesTurn(turn(championsRuntime, { "own-left": idle("garchomp", { status: "slp" }), ...base, "opponent-right": { id: "blastoise", move: "surf" } })).status).toBe("ready");
    // Timid dislikes Figy (spicy): the Berry is eaten at 30/153 as the turn starts and confuses Charizard (a fresh confusion).
    const sv = await game("scarlet_violet");
    const figy = calculateDoublesTurn(turn(sv, {
      "own-left": { id: "charizard", nature: "Timid", item: "figyberry", hp: 30, move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }));
    expect(figy.status).toBe("ready");
    if (figy.status !== "ready") return;
    expect(figy.hp["own-left"]!.conditions?.map((fact) => fact.text)).toContain("Confused.");
    expect(figy.steps[0].skipped.map((fact) => [fact.text.replace(/\d+–\d+/, "n"), fact.chance])).toEqual([["Hurts itself in confusion: n HP.", 0.33]]);
  });

  it("Focus Band when a hit into it can knock out, and Max Guard", async () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "dragonclaw", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("dragapult", { item: "focusband", hp: 20 }),
    }), "Focus Band is not modelled.", ["own-left"]);
    const swsh = await game("sword_shield");
    expectReason(turn(swsh, {
      "own-left": { id: "charizard", move: "protect", build: { mechanic: "dynamax" } }, "own-right": { id: "garchomp", move: "dragonclaw", target: "opponent-right" },
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Max Guard is not modelled.", ["own-right"]);
  });

  it("a multi-hit move into an intact Disguise", () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "aerodactyl", ability: "pressure", move: "dualwingbeat", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("mimikyu"),
    }), "Disguise against a multi-hit move is not modelled in 2v2.", ["own-left"]);
  });

  it("a spread move healing from several targets, or an attacker affected differently by each target", async () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "charizard", item: "shellbell", hp: 100, move: "heatwave" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Heat Wave heals from more than one target: not modelled.", ["own-left"]);
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "sinistcha", ability: "heatproof", hp: 100, move: "matchagotcha" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Matcha Gotcha heals from more than one target: not modelled.", ["own-left"]);
    // Breaking Swipe makes contact: Gooey lowers Garchomp's Speed from Goodra, not from Blastoise.
    expectReason(turn(sv, {
      "own-left": { id: "garchomp", move: "breakingswipe" }, "own-right": idle("charizard"),
      "opponent-left": idle("goodra", { ability: "gooey" }), "opponent-right": idle("blastoise"),
    }), "Breaking Swipe's effect on Garchomp from more than one target is not modelled.", ["own-left"]);
    // Spicy Spray burns the attacker that hits it (Mega Scovillain, Champions).
    expectReason(turn(championsRuntime, {
      "own-left": { id: "garchomp", move: "rockslide" }, "own-right": idle("charizard"),
      "opponent-left": idle("scovillainmega"), "opponent-right": idle("blastoise"),
    }), "Rock Slide's effect on Garchomp from more than one target is not modelled.", ["own-left"]);
  });

  it("a weather, terrain, Tailwind or Trick Room change that would change an ability or item", async () => {
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "charizard", move: "sunnyday" }, "own-right": idle("garchomp"),
      "opponent-left": { id: "fluttermane", move: "moonblast", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "A weather or terrain change this turn would change Protosynthesis.", ["opponent-left"]);
    expectReason(turn(sv, {
      "own-left": { id: "whimsicott", ability: "prankster", move: "tailwind" }, "own-right": idle("brambleghast", { ability: "windrider" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-left" }, "opponent-right": idle("blastoise"),
    }), "Tailwind would activate Wind Rider.", ["opponent-left"]);
    expectReason(turn(sv, {
      "own-left": { id: "hatterene", ability: "magicbounce", move: "trickroom" }, "own-right": idle("garchomp", { item: "roomservice" }),
      "opponent-left": { id: "garchomp", move: "dragonclaw", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Trick Room would activate Room Service.", ["opponent-left"]);
  });

  it("a Max Move's terrain changing a third Pokémon's Mimicry or Electric Seed (M24i, M24j)", async () => {
    const swsh = await game("sword_shield");
    const jolteon = { id: "jolteon", ability: "voltabsorb", move: "thunderbolt", target: "opponent-right" as const, build: { mechanic: "dynamax" as const } };
    expectReason(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "toxtricity", ability: "punkrock", move: "thunderbolt", target: "opponent-left" },
      "opponent-left": idle("stunfiskgalar", { ability: "mimicry" }), "opponent-right": idle("snorlax"),
    }), "A weather or terrain change this turn would change Mimicry.", ["own-left"]);
    expectReason(turn(swsh, {
      "own-left": jolteon, "own-right": { id: "snorlax", move: "bodyslam", target: "opponent-left" },
      "opponent-left": idle("blastoise", { item: "electricseed" }), "opponent-right": idle("venusaur"),
    }), "A weather or terrain change this turn would change Electric Seed.", ["own-left"]);
  });

  it("a semi-invulnerable charge turn or a switch-out with a later action", async () => {
    const sv = await game("scarlet_violet");
    expectReason(turn(sv, {
      "own-left": { id: "garchomp", move: "dig", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": { id: "venusaur", move: "energyball", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Garchomp is semi-invulnerable after Dig: later moves are not modelled.", ["opponent-left"]);
    expectReason(turn(championsRuntime, {
      "own-left": { id: "dragapult", move: "uturn", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": { id: "venusaur", move: "energyball", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "Dragapult switches out: the replacement is not known.", ["own-left", "opponent-left"]);
  });

  it("Psychic Terrain or the target's own priority shield against its ally's priority move", () => {
    expectReason(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }, { terrain: "Psychic" }), "Psychic Terrain against an ally's move is not modelled.", ["own-left"]);
    expectReason(turn(championsRuntime, {
      "own-left": { id: "weavile", move: "iceshard", target: "own-right" }, "own-right": idle("farigiraf", { ability: "armortail" }),
      "opponent-left": idle("venusaur"), "opponent-right": idle("blastoise"),
    }), "Armor Tail against an ally's move is not modelled.", ["own-left"]);
  });

  it("an ability out in 2v2 when it triggers, and a G-Max move's random status", async () => {
    const swsh = await game("sword_shield");
    expectReason(turn(swsh, {
      "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" }, "own-right": idle("garchomp"),
      "opponent-left": idle("venusaur"), "opponent-right": idle("eldegoss", { ability: "cottondown" }),
    }), "Cotton Down is not modelled in 2v2.", ["own-left"]);
    expectReason(turn(swsh, {
      "own-left": { id: "butterfree", move: "bugbuzz", target: "opponent-right", build: { mechanic: "gigantamax", configuration: { gigantamax: true } } },
      "own-right": idle("garchomp"), "opponent-left": { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-right": idle("blastoise"),
    }), "G-Max Befuddle's random status is not modelled in 2v2.", ["own-left"]);
  });
});

describe("a not-estimated turn keeps its start", () => {
  it("returns the start HP, the start rows of every damaging move and the turn facts", () => {
    const result = expectReason(turn(championsRuntime, {
      "own-left": { id: "gengar", ability: "cursedbody", move: "skillswap", target: "opponent-right" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-right" },
      "opponent-left": { id: "garchomp", move: "earthquake" }, "opponent-right": idle("blastoise"),
    }), "Skill Swap is not modelled and comes before another move.", ["own-right", "opponent-left"]);
    if (result.status !== "not-estimated") return;
    expect(result.start?.["own-right"]).toEqual({ hp: 153, maximum: 153 });
    // Earthquake from the far side reaches both of your Pokémon and its ally.
    expect(result.startRows.filter((row) => row.slot === "opponent-left").map((row) => row.target).sort()).toEqual(["opponent-right", "own-left", "own-right"]);
    // Flamethrower's start row is the 1v1 row: Charizard into Blastoise, 26–31 (Champions, probe 4b's lowest roll 26).
    const flamethrower = result.startRows.find((row) => row.slot === "own-right");
    expect(flamethrower).toMatchObject({ target: "opponent-right", row: { moveId: "flamethrower", kind: "calculated", min: 26, max: 31 } });
  });
});
