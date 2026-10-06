import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import { getBuildStats } from "@/app/lib/battle/model";
import { showdownPosition } from "@/app/(app)/training/model/positions";
import { createRandom } from "@/app/(app)/training/model/random";
import type { CellActions, ReplacePolicy } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn, needsPrelude } from "@/app/(app)/training/sim/bridge";
import { toChoiceString } from "@/app/(app)/training/sim/choices";
import { runPrelude } from "@/app/(app)/training/sim/prelude";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { splitWorlds, thawChance, wakeChance } from "@/app/(app)/training/sim/splits";
import { PRNG, State, type ClonedBattle, type PRNGSeed } from "@/app/(app)/training/sim/sim";
import { runtime, seatBattle } from "./training-sim-fixtures";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §9.4 / §13.3: bridge parity and containment, guards, split weights, preludes.

const replace: ReplacePolicy = (_side, slots, options) => slots.map((_, i) => options[i]).filter(Boolean);
const hex = (n: number) => n.toString(16).padStart(32, "0");
const choicesOf = (battle: ClonedBattle, cell: CellActions, keys: Parameters<typeof toChoiceString>[3]) => ({
  p1: toChoiceString("p1", cell.own, battle.p1.activeRequest!, keys, "p2"),
  p2: toChoiceString("p2", cell.opponent, battle.p2.activeRequest!, keys, "p2"),
});

describe("bridge", () => {
  it("builds the engine input with the simulator's stats and HP, and its clean rollouts land inside the engine's range", () => {
    let checkedStats = 0, statMismatches = 0, clean = 0, contained = 0, engineCells = 0;
    for (let k = 0; k < 6; k++) {
      const seat = seatBattle([k + 3, 5, 7, 11]);
      const choose = createChooser(k + 3);
      const random = createRandom("bridge-test", k);
      let guard = 0;
      while (!seat.battle.ended && guard++ < 60) {
        const r1 = seat.battle.p1.activeRequest, r2 = seat.battle.p2.activeRequest;
        const c1 = choose("p1", r1), c2 = choose("p2", r2);
        if (r1 && "active" in r1 && r2 && "active" in r2) {
          const inputs = seat.inputs();
          const services = createTurnServices(inputs, [seat.truthWorld(hex(guard))], { runtime, keys: seat.keys, seedBase: hex(k * 1000 + guard) });
          const belief = buildBeliefBattle(inputs, seat.truthWorld(hex(guard)), runtime);
          for (let n = 0; n < 3; n++) {
            const own = services.view.legal.own, ai = services.view.legal.opponent;
            const cell = { own: own[random.int(own.length)], opponent: ai[random.int(ai.length)] };
            if (needsPrelude(cell)) continue;
            const worlds = services.engineWorlds(cell);
            if (worlds.kind !== "engine" || worlds.worlds.length !== 1) continue;
            const world = worlds.worlds[0];
            for (const slot of DOUBLES_SLOTS) {
              const entry = world.input.pokemon[slot];
              if (!entry) continue;
              const { side, position } = showdownPosition(slot, "p2");
              const mon = belief.battle[side].active[position]!;
              const stats = getBuildStats(entry.build, runtime)!;
              checkedStats++;
              if (stats.hp !== mon.maxhp || (["atk", "def", "spa", "spd", "spe"] as const).some((stat) => stats[stat] !== mon.storedStats[stat]) || (entry.build.currentHP ?? mon.maxhp) !== mon.hp) statMismatches++;
            }
            const result = calculateDoublesOutcomes(world.input);
            if (result.status !== "ready") continue;
            engineCells++;
            const choices = choicesOf(belief.battle, cell, belief.keys);
            for (let s = 0; s < 12; s++) {
              const clone = State.deserializeBattle(belief.json);
              clone.restart(() => {});
              clone.prng = new PRNG(`sodium,${hex(k * 100000 + guard * 100 + s + 1)}` as PRNGSeed);
              let snap: number[] | null = null;
              const fieldEvent = clone.fieldEvent.bind(clone);
              clone.fieldEvent = (id: string, ...rest: unknown[]) => {
                if (id === "Residual" && !snap) snap = DOUBLES_SLOTS.map((slot) => { const { side, position } = showdownPosition(slot, "p2"); return clone[side].active[position]?.hp ?? 0; });
                return fieldEvent(id, ...rest);
              };
              const before = clone.log.length;
              clone.makeChoices(choices.p1, choices.p2);
              if (clone.midTurn) continue;
              const lines = clone.log.slice(before);
              const fakeOut = lines.some((l) => l.includes("|Fake Out|"));
              const dirty = lines.some((l) => l.startsWith("|-crit|") || l.startsWith("|-miss|") || (l.startsWith("|-status|") && !l.includes("[from]")) || (l.startsWith("|cant|") && l.includes("flinch") && !fakeOut) || (l.startsWith("|-start|") && l.includes("confusion")));
              if (dirty) continue;
              const hp: number[] = snap ?? DOUBLES_SLOTS.map((slot) => { const { side, position } = showdownPosition(slot, "p2"); return clone[side].active[position]?.hp ?? 0; });
              clean++;
              const inside = DOUBLES_SLOTS.every((slot, i) => {
                const possible = result.outcomes.flatMap((o) => o.mons[slot]?.hp.map((h) => h.hp) ?? []);
                return !possible.length || (hp[i] >= Math.min(...possible) && hp[i] <= Math.max(...possible));
              });
              if (inside) contained++;
            }
          }
        }
        seat.step(c1, c2);
      }
    }
    expect(checkedStats).toBeGreaterThan(100);
    expect(statMismatches).toBe(0);
    expect(engineCells).toBeGreaterThan(20);
    expect(clean).toBeGreaterThan(150);
    expect(contained / clean).toBeGreaterThanOrEqual(0.99);
  }, 120_000);

  it("sends what the engine does not model to rollouts, with the reason", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const cell: CellActions = {
      own: { "own-left": { kind: "move", moveId: "flareblitz", target: "opponent-right" }, "own-right": { kind: "move", moveId: "heatwave", target: null } },
      opponent: { "opponent-right": { kind: "move", moveId: "waterfall", target: "own-left" }, "opponent-left": { kind: "move", moveId: "hurricane", target: "own-right" } },
    };
    const reasonsWith = (mutate: (inputs: ReturnType<typeof seat.inputs>) => void, actions = cell) => {
      const inputs = seat.inputs();
      mutate(inputs);
      const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
      const result = bridgeTurn(belief.battle, actions, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set() });
      return result.kind === "rollout" ? result.reasons.join(" ") : "engine";
    };
    expect(reasonsWith(() => {})).toBe("engine");
    expect(reasonsWith((inputs) => inputs.public.mons["p1:incineroar"].volatiles.push({ id: "confusion", since: 1, elapsed: 0 }))).toMatch(/confusion is not modelled/);
    expect(reasonsWith((inputs) => inputs.public.mons["p2:gyarados"].volatiles.push({ id: "substitute", since: 1, elapsed: 0 }))).toMatch(/substitute is not modelled/);
    expect(reasonsWith((inputs) => inputs.public.mons["p1:charizard"].volatiles.push({ id: "twoturnmove", since: 1, elapsed: 0, moveId: "solarbeam" }))).toMatch(/twoturnmove is not modelled/);
    expect(reasonsWith(() => {}, { ...cell, own: { ...cell.own, "own-left": { kind: "move", moveId: "struggle", target: "opponent-right" } } })).toMatch(/struggle is not modelled/);
    expect(reasonsWith((inputs) => inputs.public.sides.p2.conditions.push({ id: "safeguard", since: 1, layers: 1, setterKey: null }))).toMatch(/Side effect safeguard/);
  });

  it("splits Protect, sleep and freeze with the simulator's chances (2,000 samples each, ±3 points)", () => {
    const seat = seatBattle([13, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    // Sleep's counter is drawn by the world (a rebuild per sample); Protect and freeze roll in the battle's PRNG.
    const STOP = {};
    const sample = (mutate: (inputs: ReturnType<typeof seat.inputs>) => void, cell: CellActions, hit: (lines: string[]) => boolean, rebuild = false, actor = "Incineroar") => {
      const inputs = seat.inputs();
      mutate(inputs);
      const once = buildBeliefBattle(inputs, seat.truthWorld(hex(0)), runtime);
      let count = 0;
      for (let n = 0; n < 2000; n++) {
        const belief = rebuild ? buildBeliefBattle(inputs, seat.truthWorld(hex(n)), runtime) : null;
        const battle = belief?.battle ?? State.deserializeBattle(once.json);
        if (!belief) battle.restart(() => {});
        const choices = choicesOf(battle, cell, once.keys);
        battle.prng = new PRNG(`sodium,${hex(n + 7)}` as PRNGSeed);
        const before = battle.log.length;
        // Stop once the Pokémon under test has acted: the rest of the turn does not change the count.
        const run = battle.runAction.bind(battle);
        battle.runAction = (action) => { run(action); if (action.choice === "move" && action.pokemon?.name === actor) throw STOP; };
        try { battle.makeChoices(choices.p1, choices.p2); } catch (error) { if (error !== STOP) throw error; }
        if (hit(battle.log.slice(before))) count++;
      }
      return count / 2000;
    };
    const quiet: CellActions = {
      own: { "own-left": { kind: "move", moveId: "flareblitz", target: "opponent-right" }, "own-right": { kind: "move", moveId: "protect", target: null } },
      opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const protect = sample((inputs) => { inputs.public.mons["p2:gyarados"].protectStreak = 1; }, quiet, (lines) => lines.includes("|-singleturn|p2a: Gyarados|Protect"), false, "Gyarados");
    expect(Math.abs(protect - 1 / 3)).toBeLessThan(0.03);
    const asleep = sample((inputs) => Object.assign(inputs.public.mons["p1:incineroar"], { status: "slp", statusElapsed: 1 }), quiet, (lines) => lines.some((l) => l.startsWith("|-curestatus|p1a: Incineroar|slp")), true);
    expect(Math.abs(asleep - wakeChance(1, false))).toBeLessThan(0.03);
    const frozen = sample((inputs) => Object.assign(inputs.public.mons["p1:incineroar"], { status: "frz", statusElapsed: 0 }),
      { ...quiet, own: { ...quiet.own, "own-left": { kind: "move", moveId: "partingshot", target: "opponent-right" } } },
      (lines) => lines.some((l) => l.startsWith("|-curestatus|p1a: Incineroar|frz")));
    expect(Math.abs(frozen - thawChance(0, false))).toBeLessThan(0.03);
    // The engine-side split gives the same weights.
    const inputs = seat.inputs();
    inputs.public.mons["p2:gyarados"].protectStreak = 1;
    const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
    const bridged = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set() });
    expect(bridged.kind).toBe("engine");
    if (bridged.kind !== "engine") return;
    const split = splitWorlds(bridged.input, { runtime, slotKeys: bridged.keys, publicOf: (key) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null });
    expect(split.kind === "worlds" ? split.worlds.map((w) => +w.weight.toFixed(4)) : null).toEqual([0.3333, 0.6667]);
  }, 120_000);

  it("runs the prelude for a switch into Intimidate and for Mega Charizard Y's Drought", () => {
    const seat = seatBattle([17, 2, 3, 4]);
    seat.step("team 2413", "team 2513");
    // p2 leads Pelipper and Farigiraf; Gyarados (Intimidate) on the bench. p1 leads Charizard (Charizardite Y) and Garchomp.
    const belief = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
    const cell: CellActions = {
      own: { "own-left": { kind: "move", moveId: "heatwave", target: null, mega: "mega" }, "own-right": { kind: "move", moveId: "earthquake", target: null } },
      opponent: { "opponent-right": { kind: "switch", to: "gyarados" }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const choices = choicesOf(belief.battle, cell, belief.keys);
    expect(choices).toEqual({ p1: "move 1 mega, move 1", p2: "switch 3, move 4" });
    const prelude = runPrelude(belief.json, choices, hex(1));
    expect(prelude.kind).toBe("stopped");
    if (prelude.kind !== "stopped") return;
    expect(prelude.battle.p2.active[0]!.name).toBe("Gyarados");
    expect(prelude.battle.p1.active[0]!.species.id).toBe("charizardmegay");
    expect(prelude.battle.field.weather).toBe("sunnyday");
    const bridged = bridgeTurn(prelude.battle, cell, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(["opponent-right"]) });
    expect(bridged.kind).toBe("engine");
    if (bridged.kind !== "engine") return;
    expect(bridged.input.field.weather).toBe("Sun");
    expect(bridged.input.pokemon["own-left"]!.build).toMatchObject({ speciesId: "charizardmegay", abilityId: "drought" });
    expect(bridged.input.pokemon["own-right"]!.build.boosts.atk).toBe(-1);   // Gyarados's Intimidate
    expect(bridged.input.pokemon["opponent-right"]!.action).toEqual({ moveId: null, target: null });
    expect(bridged.keys["opponent-right"]).toBe("opponent:gyarados");
    // Services take the same path: a prelude-sourced engine world.
    const services = createTurnServices(seat.inputs(), [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: hex(2) });
    const worlds = services.engineWorlds(cell);
    expect(worlds.kind === "engine" ? worlds.source : worlds.kind).toBe("prelude");
    const post = services.rollout(cell, 0, replace);
    expect(post.megaUsed.own).toBe(true);
    expect(post.mons.find((m) => m.key === "own:charizard")?.build.speciesId).toBe("charizardmegay");
  });
});
