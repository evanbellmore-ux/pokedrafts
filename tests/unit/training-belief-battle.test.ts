import { describe, expect, it } from "vitest";
import { OPEN_TEAM_SHEETS } from "@/app/(app)/training/model/info";
import type { ShowdownRequest } from "@/app/(app)/training/model/showdown-types";
import { buildBeliefBattle, hpBand } from "@/app/(app)/training/sim/belief-battle";
import { PRNG, State, type PRNGSeed } from "@/app/(app)/training/sim/sim";
import { runtime, seatBattle } from "./training-sim-fixtures";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §9.2 / §9.3 / §13.3: battles rebuilt from the AI's seat, hidden durations redrawn from public counts.

const strip = (lines: readonly string[]) => lines.filter((line) => !line.startsWith("|t:|") && line !== "|");
const hiddenInPlay = (battle: { getAllPokemon(): { status: string; volatiles: Record<string, unknown> }[] }) =>
  battle.getAllPokemon().some((p) => p.status === "slp" || p.status === "frz" || p.volatiles.confusion || p.volatiles.lockedmove || p.volatiles.twoturnmove || p.volatiles.partiallytrapped);

describe("buildBeliefBattle", () => {
  it("with the truth as its world, matches the real battle: requests equal and the same one-turn log (6 battles)", () => {
    let decisions = 0, clean = 0, cleanSame = 0, requestsEqual = 0;
    for (let k = 0; k < 6; k++) {
      const seat = seatBattle([k + 61, 2, 3, 4]);
      const choose = createChooser(k + 61);
      let guard = 0;
      while (!seat.battle.ended && guard++ < 200) {
        const r1 = seat.battle.p1.activeRequest, r2 = seat.battle.p2.activeRequest;
        const c1 = choose("p1", r1), c2 = choose("p2", r2);
        if (r1 && "active" in r1 && r2 && "active" in r2) {
          decisions++;
          const belief = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
          if (JSON.stringify(belief.battle.p1.activeRequest) === JSON.stringify(r1) && JSON.stringify(belief.battle.p2.activeRequest) === JSON.stringify(r2)) requestsEqual++;
          if (!hiddenInPlay(seat.battle)) {
            clean++;
            const seed = `sodium,${(k * 1000 + guard).toString(16).padStart(32, "0")}` as PRNGSeed;
            const real = State.deserializeBattle(JSON.stringify(State.serializeBattle(seat.battle)));
            real.restart(() => {}); real.prng = new PRNG(seed); belief.battle.prng = new PRNG(seed);
            const a = real.log.length, b = belief.battle.log.length;
            real.makeChoices(c1, c2); belief.battle.makeChoices(c1, c2);
            if (strip(real.log.slice(a)).join("\n") === strip(belief.battle.log.slice(b)).join("\n")) cleanSame++;
          }
        }
        seat.step(c1, c2);
      }
    }
    expect(decisions).toBeGreaterThan(60);
    expect(requestsEqual).toBe(decisions);
    expect(cleanSame).toBe(clean);
  }, 60_000);

  it("plays a turn with a wrong Stat Point guess and HP from the shown band (default settings)", () => {
    const seat = seatBattle([3, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    seat.step("move 2 1, move 1", "move 1 1, move 2 2");
    const world = seat.truthWorld("1".repeat(32), "sample");
    for (const set of Object.values(world.sets)) set.evs = { hp: 2, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 };
    const inputs = seat.inputs(OPEN_TEAM_SHEETS);
    expect(inputs.reveals.exactHP).toBeNull();
    const belief = buildBeliefBattle(inputs, world, runtime);
    const shown = inputs.public.mons["p1:incineroar"].hp;
    expect(hpBand(shown, belief.battle.p1.pokemon[0].maxhp)).toContain(belief.battle.p1.pokemon[0].hp);
    expect(() => belief.battle.makeChoices("move 2 1, move 1", "move 1 1, move 1 1")).not.toThrow();
    expect(JSON.parse(belief.json).turn).toBe(inputs.public.turn);
  });

  it("does not let construction use up an item the Pokémon still holds (White Herb against an earlier Intimidate)", () => {
    // Incineroar's Intimidate fires at the start; Sneasler comes in later, untouched, still holding White Herb.
    const seat = seatBattle([5, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    seat.step("move 4, move 4", "switch 3, move 4");
    const sneasler = seat.battle.p2.active[0]!;
    expect(sneasler.name).toBe("Sneasler");
    expect(sneasler.item).toBe("whiteherb");
    const belief = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
    const rebuilt = belief.battle.p2.active[0]!;
    expect(rebuilt.item).toBe("whiteherb");
    expect(rebuilt.boosts.atk).toBe(sneasler.boosts.atk);
  });

  it("redraws sleep, confusion and lock counters within what the public counts allow; durations follow R2", () => {
    const seat = seatBattle([7, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    seat.step("move 4, move 4", "move 4, move 4");
    const inputs = seat.inputs();
    const turn = inputs.public.turn;
    const incineroar = inputs.public.mons["p1:incineroar"], charizard = inputs.public.mons["p1:charizard"];
    Object.assign(incineroar, { status: "slp", statusElapsed: 1 });
    charizard.volatiles.push({ id: "confusion", since: turn - 1, elapsed: 2 });
    charizard.lock = { moveId: "outrage", turns: 1 };
    inputs.public.sides.p1.conditions.push({ id: "tailwind", since: turn - 1, layers: 1, setterKey: "p1:whimsicott" });
    inputs.public.mons["p2:gyarados"].volatiles.push({ id: "notarealeffect", since: turn, elapsed: 0 });
    const starts = new Set<number>(), times = new Set<number>(), locks = new Set<number>();
    for (let n = 0; n < 40; n++) {
      const belief = buildBeliefBattle(inputs, { ...seat.truthWorld(n.toString(16).padStart(32, "0")) }, runtime);
      const [p1a, p1b] = belief.battle.p1.active;
      starts.add(Number(p1a!.statusState.startTime));
      expect(Number(p1a!.statusState.time)).toBe(Number(p1a!.statusState.startTime) - 1);
      times.add(Number(p1b!.volatiles.confusion.time));
      locks.add(Number(p1b!.volatiles.lockedmove.trueDuration));
      expect(belief.battle.p1.sideConditions.tailwind.duration).toBe(3);
      expect(belief.approximations).toContain("Effect not rebuilt: notarealeffect.");
    }
    // Sleep: startTime from [2, 3, 3] above one attempt; confusion: 2–5 attempts above two; lock: 1 or 2 more uses.
    expect([...starts].sort()).toEqual([2, 3]);
    expect([...times].sort()).toEqual([1, 2, 3]);
    expect([...locks].sort()).toEqual([1, 2]);
  });

  it("never reads anything but AiInputs and the world (no Battle argument)", () => {
    const seat = seatBattle([9, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const inputs = seat.inputs();
    expect(() => structuredClone(inputs)).not.toThrow();
    const a = buildBeliefBattle(structuredClone(inputs), seat.truthWorld(), runtime);
    const b = buildBeliefBattle(structuredClone(inputs), seat.truthWorld(), runtime);
    expect(a.json).toBe(b.json);
    expect((inputs.request as ShowdownRequest).side.id).toBe("p2");
  });
});
