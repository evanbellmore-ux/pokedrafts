import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import { getBuildStats } from "@/app/lib/battle/model";
import { showdownPosition } from "@/app/(app)/training/model/positions";
import { createRandom } from "@/app/(app)/training/model/random";
import type { CellActions, ReplacePolicy } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn, needsPrelude, SPLITS_BRANCH_SLEEP } from "@/app/(app)/training/sim/bridge";
import { toChoiceString } from "@/app/(app)/training/sim/choices";
import { runPrelude } from "@/app/(app)/training/sim/prelude";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { splitWorlds, thawChance, wakeChance } from "@/app/(app)/training/sim/splits";
import { PRNG, State, type ClonedBattle, type PRNGSeed } from "@/app/(app)/training/sim/sim";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";
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
            // With the end of turn applied (status-eot SPEC §6) the outcomes are after the whole turn: read Showdown's HP then.
            const afterTurn = result.endOfTurn === "applied";
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
              const now = DOUBLES_SLOTS.map((slot) => { const { side, position } = showdownPosition(slot, "p2"); return clone[side].active[position]?.hp ?? 0; });
              const hp: number[] = afterTurn ? now : snap ?? now;
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
    const bridged = (mutate: (inputs: ReturnType<typeof seat.inputs>) => void, actions = cell, counts = false) => {
      const inputs = seat.inputs();
      mutate(inputs);
      const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
      const publicOf = counts ? (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null : undefined;
      return bridgeTurn(belief.battle, actions, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
    };
    const reasonsWith = (mutate: (inputs: ReturnType<typeof seat.inputs>) => void, actions = cell, counts = false) => {
      const result = bridged(mutate, actions, counts);
      return result.kind === "rollout" ? result.reasons.join(" ") : "engine";
    };
    expect(reasonsWith(() => {})).toBe("engine");
    // Confusion is carried from the public counts (status-eot SPEC §6): without them, a rollout.
    const confused = (inputs: ReturnType<typeof seat.inputs>) => inputs.public.mons["p1:incineroar"].volatiles.push({ id: "confusion", since: 1, elapsed: 2 });
    expect(reasonsWith(confused)).toMatch(/Incineroar: its confusion needs the public counts/);
    const withCounts = bridged(confused, cell, true);
    expect(withCounts.kind === "engine" ? withCounts.input.pokemon["own-left"]!.carried : withCounts.reasons).toEqual({ confusion: { attempts: 2 } });
    // A Substitute is carried while no hit has met it (its maker's quarter); after a hit its HP is not public.
    expect(reasonsWith((inputs) => inputs.public.mons["p2:gyarados"].volatiles.push({ id: "substitute", since: 1, elapsed: 0 }), cell, true)).toMatch(/Gyarados: its Substitute's HP after a hit is not public/);
    expect(reasonsWith((inputs) => inputs.public.mons["p2:gyarados"].volatiles.push({ id: "substitute", since: 1, elapsed: 0, sourceKey: "p2:gyarados", hits: 1 } as never), cell, true)).toMatch(/Substitute's HP after a hit is not public/);
    const sub = bridged((inputs) => inputs.public.mons["p2:gyarados"].volatiles.push({ id: "substitute", since: 1, elapsed: 0, sourceKey: "p2:gyarados", hits: 0 } as never), cell, true);
    if (sub.kind !== "engine") throw new Error(sub.reasons.join(" "));
    const gyarados = sub.input.pokemon["opponent-right"]!;
    expect(gyarados.carried?.substitute).toBe(Math.floor(getBuildStats(gyarados.build, runtime)!.hp / 4));
    expect(reasonsWith((inputs) => inputs.public.mons["p1:charizard"].volatiles.push({ id: "twoturnmove", since: 1, elapsed: 0, moveId: "solarbeam" }))).toMatch(/twoturnmove is not modelled/);
    expect(reasonsWith(() => {}, { ...cell, own: { ...cell.own, "own-left": { kind: "move", moveId: "struggle", target: "opponent-right" } } })).toMatch(/struggle is not modelled/);
    expect(reasonsWith((inputs) => inputs.public.sides.p2.conditions.push({ id: "safeguard", since: 1, layers: 1, setterKey: null }))).toMatch(/Side effect safeguard/);
  });

  it("carries the state from earlier turns: public counts for the hidden ones, the belief battle's per world (status-eot SPEC §6)", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const quiet: CellActions = {
      own: { "own-left": { kind: "move", moveId: "flareblitz", target: "opponent-right" }, "own-right": { kind: "move", moveId: "protect", target: null } },
      opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const inputs = seat.inputs();
    const turn = inputs.public.turn;
    const pub = inputs.public.mons;
    Object.assign(pub["p1:incineroar"], { status: "slp", statusElapsed: 1, restSleep: true });
    Object.assign(pub["p2:gyarados"], { status: "tox", statusElapsed: 3 });
    pub["p2:gyarados"].volatiles.push({ id: "leechseed", since: turn, elapsed: 0, sourceKey: "p1:charizard" });
    pub["p2:pelipper"].volatiles.push({ id: "partiallytrapped", since: turn, elapsed: 0, moveId: "firespin", sourceKey: "p1:incineroar" });
    pub["p1:charizard"].volatiles.push({ id: "yawn", since: turn - 1, elapsed: 0, sourceKey: "p2:pelipper" }, { id: "perishsong", since: turn, elapsed: 0, layers: 2 }, { id: "focusenergy", since: turn, elapsed: 0 });
    pub["p1:incineroar"].lastMove = "fakeout";
    const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
    const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
    const result = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
    if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
    const { pokemon } = result.input;
    // Sleep is split before the engine (sim/splits.ts) while SPLITS_BRANCH_SLEEP holds: no sleep counts passed then.
    expect(pokemon["own-left"]!.carried).toEqual(SPLITS_BRANCH_SLEEP ? undefined : { sleep: { attempts: 1, rest: true } });
    expect(pokemon["own-left"]!.lastMove).toBe("fakeout");
    expect(pokemon["own-left"]!.moves).toEqual(belief.battle.p1.active[0]!.moveSlots.map((each) => each.id));
    expect(pokemon["own-right"]!.carried).toEqual({ yawn: true, perish: 2 });
    expect(pokemon["own-right"]!.build.focusEnergy).toBe(true);
    expect(pokemon["opponent-right"]!.carried).toEqual({ toxic: 3, leechSeed: "own-right" });
    // The trap's move (public: its -activate line) names the residual.
    expect(pokemon["opponent-left"]!.carried).toEqual({ trap: { source: "own-left", bindingBand: false, move: "firespin" } });
    expect(result.input.canSwitch).toEqual({ own: true, opponent: true });
    expect(result.input.weatherTurns).toBe(Number(belief.battle.field.weatherState.duration));
    // The engine runs it: Gyarados's bad poison stage 3 → 4/16, the drain into Charizard.
    const outcomes = calculateDoublesOutcomes(result.input);
    expect(outcomes.status).toBe("ready");
    // Without the public counts a confused Pokémon is a rollout; Ingrain on a Flying type too.
    const confused = seat.inputs();
    confused.public.mons["p1:charizard"].volatiles.push({ id: "confusion", since: confused.public.turn, elapsed: 1 });
    const confusedBelief = buildBeliefBattle(confused, seat.truthWorld(), runtime);
    expect(bridgeTurn(confusedBelief.battle, quiet, { runtime, keys: confusedBelief.keys, aiSide: "p2", switched: new Set() })).toMatchObject({ kind: "rollout", reasons: ["Charizard: its confusion needs the public counts."] });
    const rooted = seat.inputs();
    rooted.public.mons["p1:charizard"].volatiles.push({ id: "ingrain", since: rooted.public.turn, elapsed: 0 });
    const rootedBelief = buildBeliefBattle(rooted, seat.truthWorld(), runtime);
    expect(bridgeTurn(rootedBelief.battle, quiet, { runtime, keys: rootedBelief.keys, aiSide: "p2", switched: new Set(), publicOf })).toMatchObject({ kind: "rollout", reasons: ["Charizard: Ingrain on a Pokémon that is not grounded otherwise is not modelled."] });
  });

  it("carries a Future Sight only on the turn it lands: two turns after its use (data/conditions.ts futuremove; EOT-4)", () => {
    const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
    const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    const set = (species: string, item: string, ability: string, moves: string[], nature: string, evs: ReturnType<typeof sp>) =>
      ({ name: species, species, item, ability, moves, nature, evs, ivs: IV, level: 50, gender: "" as const });
    const player = [
      set("Snorlax", "Leftovers", "Thick Fat", ["Protect", "Body Slam", "Yawn", "Curse"], "Careful", sp(32, 2, 16, 0, 16, 0)),
      set("Garchomp", "Life Orb", "Rough Skin", ["Protect", "Dragon Claw", "Rock Slide", "Earthquake"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
      set("Kingambit", "Black Glasses", "Defiant", ["Protect", "Sucker Punch", "Iron Head", "Kowtow Cleave"], "Adamant", sp(32, 32, 0, 0, 2, 0)),
      set("Rotom-Wash", "Sitrus Berry", "Levitate", ["Protect", "Thunderbolt", "Will-O-Wisp", "Hydro Pump"], "Modest", sp(32, 0, 2, 32, 0, 0)),
    ];
    const ai = [
      set("Farigiraf", "Lum Berry", "Armor Tail", ["Future Sight", "Protect", "Psychic", "Trick Room"], "Quiet", sp(32, 0, 2, 32, 0, 0)),
      set("Clefable", "Leftovers", "Magic Guard", ["Protect", "Moonblast", "Future Sight", "Follow Me"], "Bold", sp(32, 0, 32, 0, 2, 0)),
      set("Sneasler", "White Herb", "Unburden", ["Protect", "Close Combat", "Dire Claw", "Fake Out"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
      set("Pelipper", "Mystic Water", "Drizzle", ["Protect", "Weather Ball", "Tailwind", "Hurricane"], "Modest", sp(32, 0, 0, 32, 2, 0)),
    ];
    const seat = seatBattle([1, 2, 3, 4], { own: toShowdownTeam(player.map((each) => memberFromSet(each)), runtime), opponent: toShowdownTeam(ai.map((each) => memberFromSet(each)), runtime) });
    seat.step("team 1234", "team 1234");
    // Turn 1: Farigiraf (p2a) uses Future Sight on Snorlax (p1a); the others Protect.
    seat.step("move 1, move 1", "move 1 1, move 1");
    const protect: CellActions = {
      own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
      opponent: { "opponent-left": { kind: "move", moveId: "protect", target: null }, "opponent-right": { kind: "move", moveId: "protect", target: null } },
    };
    const seen: { turn: number; carried: string | null; lands: boolean }[] = [];
    for (const turn of [2, 3]) {
      expect(seat.battle.turn).toBe(turn);
      const inputs = seat.inputs();
      const belief = buildBeliefBattle(inputs, seat.truthWorld(hex(turn)), runtime);
      const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
      const result = bridgeTurn(belief.battle, protect, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
      if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
      const before = seat.battle.log.length;
      seat.step("move 1, move 1", "move 2, move 1");
      seen.push({ turn, carried: result.input.pokemon["own-left"]!.carried?.futureMove ?? null, lands: seat.battle.log.slice(before).some((line) => line.startsWith("|-end|") && line.includes("Future Sight")) });
    }
    // Pinned Showdown lands it at the end of turn 3 ((turn − 1) mod 256 ≥ endingTurn 2); the bridge says so on that turn only.
    expect(seen).toEqual([{ turn: 2, carried: null, lands: false }, { turn: 3, carried: "futuresight", lands: true }]);
  });

  it("Leech Seed heals the position the seeder seeded from, wherever the seeder stands now (EOT-5, pool E)", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const quiet: CellActions = {
      own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
      opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const seeded = (sourcePosition: 0 | 1 | undefined) => {
      const inputs = seat.inputs();
      // Charizard stands at p1b; the seed's position says where it seeded from.
      inputs.public.mons["p2:gyarados"].volatiles.push({ id: "leechseed", since: inputs.public.turn, elapsed: 0, sourceKey: "p1:charizard", ...(sourcePosition === undefined ? {} : { sourcePosition }) });
      const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
      const result = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set() });
      if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
      return result.input.pokemon["opponent-right"]!.carried?.leechSeed;
    };
    expect(seeded(undefined)).toBe("own-right");
    expect(seeded(1)).toBe("own-right");
    expect(seeded(0)).toBe("own-left");
  });

  it("Magic Room with one turn left and an item that acts after its countdown: a rollout (order 27.6; verify-eot-training)", () => {
    // Pinned (build/verify-eot-probes/field-end-probe.ts): the room ends at 27.6, and White Herb (29) and the final Update's
    // Berries act after it; the engine takes no turns left for the room and keeps it through the residual.
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const quiet: CellActions = {
      own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
      opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const bridged = (duration: number | null, item: string) => {
      const belief = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
      const battle = belief.battle;
      for (const side of ["p1", "p2"] as const) for (const mon of battle[side].active) if (mon) (mon as { item: string }).item = "";
      (battle.p1.active[0] as { item: string }).item = item;
      if (duration !== null) {
        // The simulator's Field (sim/field.ts addPseudoWeather), whose WritableField type leaves the method out.
        (battle.field as unknown as { addPseudoWeather(id: string, source: unknown): void }).addPseudoWeather("magicroom", battle.p1.active[0]);
        (battle.field.pseudoWeather.magicroom as { duration: number }).duration = duration;
      }
      const result = bridgeTurn(battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set() });
      return result.kind === "rollout" ? result.reasons.join(" ") : "engine";
    };
    expect(bridged(1, "sitrusberry")).toMatch(/Magic Room ending this turn is not modelled/);
    expect(bridged(1, "whiteherb")).toMatch(/Magic Room ending this turn is not modelled/);
    // More turns left, or only an item whose residual comes before the countdown (Leftovers 5.4): the engine.
    expect(bridged(2, "sitrusberry")).toBe("engine");
    expect(bridged(1, "leftovers")).toBe("engine");
    expect(bridged(null, "sitrusberry")).toBe("engine");
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
    const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
    const split = splitWorlds(bridged.input, { runtime, slotKeys: bridged.keys, publicOf });
    expect(split.kind === "worlds" ? split.worlds.map((w) => +w.weight.toFixed(4)) : null).toEqual([0.3333, 0.6667]);
    // Sleep and freeze are the engine's own BeforeMove now: no split for them.
    expect(SPLITS_BRANCH_SLEEP).toBe(false);
    // A confused Protect user under Gravity: its failing world (No move, which Gravity stops before confusion) is a rollout.
    const slot = DOUBLES_SLOTS.find((each) => bridged.keys[each] === "opponent:gyarados")!;
    const gravity = structuredClone({ ...bridged.input, runtime: undefined }) as unknown as typeof bridged.input;
    gravity.runtime = bridged.input.runtime;
    gravity.field = { ...gravity.field, gravity: true };
    gravity.pokemon[slot] = { ...gravity.pokemon[slot]!, carried: { confusion: { attempts: 0 } } };
    expect(splitWorlds(gravity, { runtime, slotKeys: bridged.keys, publicOf })).toEqual({ kind: "rollout", reasons: ["Protect under Gravity while confused: its failing world is not modelled."] });
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
