import { describe, expect, it } from "vitest";
import { startRowLine } from "@/app/(app)/calculator/doubles-format";
import { calculateDoublesMoves, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesNames, type DoublesCarried, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * status-eot final gate (scripts/.cache/calc-audit/status-eot/build/FINAL.md), against pinned Showdown c23d2e94:
 * - a Substitute from an earlier turn in the start rows and the Moves pane (VERIFY-ui open item 3): a move that meets it
 *   (not a sound move, no Infiltrator) is not estimated there, since the calculation into the Pokémon is not what the move
 *   deals (Rock Blast into a 30 HP Substitute: Showdown's most is 124 by 1-4 hits, the calculation's 155 by 2-5); a sound
 *   move passes it (bypasssub) and a type immunity comes before it (sim/battle-actions.ts hitStepTypeImmunity);
 * - a status move refused by a type immunity is a hit with no effect (ui F7 b: sim/pokemon.ts setStatus runStatusImmunity
 *   adds -immune for a status move), as Spore into a Grass type is.
 */
type P = { id: string; ability?: string; item?: string; status?: BattleStatus; hp?: number; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });

async function turn(game: BattleGame, slots: [P, P, P, P]): Promise<DoublesTurnInput> {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: p.status ?? "", currentHP: p.hp ?? null } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
}

describe("a Substitute from an earlier turn in the start rows and the Moves pane", () => {
  it("a not-estimated turn's start row into it is not estimated, with the fact", async () => {
    const input = await turn("scarlet_violet", [
      { id: "tyranitar", ability: "unnerve", move: "rockblast", target: "opponent-left" }, { id: "clefable", ability: "magicguard", move: "metronome" },
      idle("snorlax", { ability: "thickfat", carried: { substitute: 30 } }), idle("charizard"),
    ]);
    const result = calculateDoublesTurn(input);
    expect(result).toMatchObject({ status: "not-estimated", reason: "Metronome is not modelled in 2v2." });
    if (result.status !== "not-estimated") return;
    const rows = result.startRows.filter((entry) => entry.slot === "own-left");
    expect(rows.map((entry) => ({ target: entry.target, kind: entry.row.kind, reason: entry.row.reason, name: entry.row.effectiveName }))).toEqual([
      { target: "opponent-left", kind: "unsupported", reason: "Snorlax is behind a Substitute.", name: "Rock Blast" },
    ]);
    const names = doublesNames(input.pokemon, input.runtime);
    expect(startRowLine(rows[0], names, input.runtime)).toBe("Rock Blast · Tyranitar → Snorlax: Snorlax is behind a Substitute.");
  });

  it("the Moves pane: a move that meets it is not estimated; a sound move and an immunity stay", async () => {
    const input = await turn("scarlet_violet", [
      { id: "tyranitar", ability: "unnerve", move: null }, idle("clefable", { ability: "magicguard" }),
      idle("snorlax", { ability: "thickfat", carried: { substitute: 30 } }), idle("charizard", { carried: { substitute: 38 } }),
    ]);
    const into = (target: DoublesSlotId, moveId: string) => calculateDoublesMoves(input, "own-left", target).results.find((row) => row.moveId === moveId)!;
    expect(into("opponent-left", "rockblast")).toMatchObject({ kind: "unsupported", reason: "Snorlax is behind a Substitute.", min: null, max: null });
    expect(into("opponent-left", "crunch")).toMatchObject({ kind: "unsupported", reason: "Snorlax is behind a Substitute." });
    // Snarl is a sound move (bypasssub): calculated into Snorlax.
    expect(into("opponent-left", "snarl")).toMatchObject({ kind: "calculated" });
    expect(into("opponent-left", "snarl").max).toBeGreaterThan(0);
    // Earthquake into a Flying type: the immunity comes first, the row says no damage as before.
    const quake = into("opponent-right", "earthquake");
    expect(quake.kind === "calculated" && quake.max === 0).toBe(true);
    // Without the Substitute the rows are calculated.
    const plain = await turn("scarlet_violet", [{ id: "tyranitar", ability: "unnerve", move: null }, idle("clefable", { ability: "magicguard" }), idle("snorlax", { ability: "thickfat" }), idle("charizard")]);
    expect(calculateDoublesMoves(plain, "own-left", "opponent-left").results.find((row) => row.moveId === "rockblast")).toMatchObject({ kind: "calculated" });
  });
});

describe("a status move refused by a type immunity", () => {
  it("Will-O-Wisp into a Fire type is a hit with no effect, as Spore into a Grass type", async () => {
    const result = calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "gengar", ability: "cursedbody", move: "willowisp", target: "opponent-left" }, { id: "amoonguss", ability: "regenerator", move: "spore", target: "opponent-right" },
      idle("charizard"), idle("venusaur"),
    ]));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const hit = (slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.hits[0];
    expect(hit("own-left")).toMatchObject({ slot: "opponent-left", kind: "no-damage", reached: 1, facts: [{ text: "Charizard is immune.", chance: 1 }] });
    expect(hit("own-right")).toMatchObject({ slot: "opponent-right", kind: "no-damage", reached: 1, facts: [{ text: "Venusaur is immune.", chance: 1 }] });
    expect(result.hp["opponent-left"]!.conditions ?? []).toEqual([]);
  });
});

describe("the end of turn follows a Berserk or Anger Shell lock (status H1, FN01-FN04)", () => {
  // A confusion self-hit (a Move effect) locks the holder's healing Berry (data/abilities.ts berserk onTryEatItem); a
  // residual's damage resets the lock (onDamage: checkedBerserk true) and the Update after it eats the Berry; a heal does not.
  const confused = (id: string, ability: string, hp: number, extra: Partial<P> = {}): P => ({ id, ability, item: "sitrusberry", hp, carried: { confusion: { attempts: 0 } }, ...extra });
  const eot = (result: ReturnType<typeof calculateDoublesTurn>, slot: DoublesSlotId) => {
    if (result.status !== "ready" || result.endOfTurn.status !== "ready") throw new Error(JSON.stringify(result.status === "ready" ? result.endOfTurn : result.status));
    return result.endOfTurn.hp[slot]!;
  };
  it("eats the Sitrus after the sand's damage (FN01, SwSh): Showdown 99–102 after a self-hit, 114 without", async () => {
    const input = await turn("sword_shield", [confused("drampa", "berserk", 85), idle("snorlax", { ability: "thickfat" }), idle("blastoise"), idle("venusaur")]);
    input.field = { ...input.field, weather: "Sand" };
    input.weatherTurns = 3;
    const hp = eot(calculateDoublesTurn(input), "own-left");
    expect([hp.min, hp.max]).toEqual([99, 114]);
  });
  it("keeps the Sitrus through Grassy Terrain's heal (FN04): Showdown 67–70 after a self-hit, the Berry held", async () => {
    const input = await turn("scarlet_violet", [{ ...confused("klawf", "angershell", 75), move: "rockslide" }, idle("snorlax", { ability: "thickfat" }), idle("blastoise"), idle("venusaur")]);
    input.field = { ...input.field, terrain: "Grassy" };
    const result = calculateDoublesTurn(input);
    const hp = eot(result, "own-left");
    expect([hp.min, hp.max]).toEqual([67, 84]);
    expect(result.status === "ready" && result.endOfTurn.status === "ready" ? result.endOfTurn.residuals.filter((each) => each.slot === "own-left").map((each) => each.effect) : null).toEqual(["Grassy Terrain"]);
  });
});

describe("a weather the moves set again (EOT-1, World.weatherSet: FN05, FN06)", () => {
  const slots = (): [P, P, P, P] => [
    { id: "pelipper", ability: "keeneye", move: "raindance" }, { id: "tyranitar", ability: "unnerve", move: "sandstorm" },
    idle("snorlax", { ability: "thickfat", hp: 150 }), idle("venusaur", { hp: 150 }),
  ];
  it("goes on with its new duration: sand from before with one turn left, Rain Dance, then Sandstorm (FN05)", async () => {
    const input = { ...(await turn("scarlet_violet", slots())), weatherTurns: 1 };
    input.field = { ...input.field, weather: "Sand" };
    const result = calculateDoublesTurn(input);
    if (result.status !== "ready" || result.endOfTurn.status !== "ready") throw new Error(result.status);
    // Showdown: the new sand counts to 4 and deals 1/16 (Snorlax 14, Venusaur 9); no "Sandstorm ends.".
    expect([result.endOfTurn.hp["opponent-left"]!.min, result.endOfTurn.hp["opponent-right"]!.min]).toEqual([136, 141]);
    expect(result.endOfTurn.facts).toEqual([]);
  });
  it("needs no assumption about the old weather's turns (FN06)", async () => {
    const input = await turn("scarlet_violet", slots());
    input.field = { ...input.field, weather: "Sand" };
    const result = calculateDoublesTurn(input);
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.facts.some((fact) => fact.includes("does not end this turn"))).toBe(false);
  });
});
