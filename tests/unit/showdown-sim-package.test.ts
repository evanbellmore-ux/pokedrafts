import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as sim from "@pokedrafts/showdown-sim";
import type { ChoiceRequest, PokemonSet } from "@pokedrafts/showdown-sim";
import type { ShowdownRequest, ShowdownSet } from "@/app/(app)/training/model/showdown-types";
import { AI, FIXTURE_BATTLES, FORMAT, PLAYER, SOURCE_LOG_HASHES, playFixtureBattle } from "../../scripts/lib/showdown-sim/fixtures.mjs";
import packageJSON from "../../package.json";

// The vendored simulator (SPEC §6.1, §13.3): exports, kept class names, provenance, the gate's battle hashes, clones.

const provenance = JSON.parse(readFileSync(new URL("../../vendor/showdown-sim.provenance.json", import.meta.url), "utf8")) as {
  version: string; revision: string; archive: string; sha256: string; distSha256: string; gate: { logHashes: string[]; validations: number; beliefRebuild: { decisions: number; identical: number } };
};

describe("@pokedrafts/showdown-sim", () => {
  it("exports the simulator API, including extractChannelMessages", () => {
    for (const name of ["Battle", "extractChannelMessages", "Dex", "toID", "State", "Teams", "TeamValidator", "PRNG"]) {
      expect(sim, name).toHaveProperty(name);
    }
    expect(sim.toID("Charizard-Mega-Y")).toBe("charizardmegay");
  });

  it("keeps class names (State refs use constructor.name, PS/sim/state.ts:377-381)", () => {
    expect(sim.Battle.name).toBe("Battle");
    const battle = new sim.Battle({ formatid: FORMAT, seed: [1, 2, 3, 4] });
    battle.setPlayer("p1", { name: "You", team: structuredClone(PLAYER) });
    battle.setPlayer("p2", { name: "Training", team: structuredClone(AI) });
    expect(battle.p1.pokemon[0].constructor.name).toBe("Pokemon");
    expect(battle.p1.constructor.name).toBe("Side");
  });

  it("is the tarball the provenance file describes, pinned to c23d2e94", () => {
    const tarball = readFileSync(new URL(`../../vendor/${provenance.archive}`, import.meta.url));
    expect(createHash("sha256").update(tarball).digest("hex")).toBe(provenance.sha256);
    expect(packageJSON.dependencies["@pokedrafts/showdown-sim"]).toBe(`file:vendor/${provenance.archive}`);
    expect(provenance.revision).toBe("c23d2e942c9c0daadb13a7162a385bf78e3c9353");
    const dist = readFileSync(new URL("../../node_modules/@pokedrafts/showdown-sim/dist/index.mjs", import.meta.url));
    expect(createHash("sha256").update(dist).digest("hex")).toBe(provenance.distSha256);
    expect(provenance.gate.validations).toBeGreaterThan(17000);
    expect(provenance.gate.beliefRebuild.identical).toBe(provenance.gate.beliefRebuild.decisions);
  });

  it("replays the 20 fixture battles with the provenance log hashes (equal to the pinned TypeScript source)", () => {
    const hashes: string[] = [];
    let clones = 0;
    for (let k = 0; k < FIXTURE_BATTLES; k++) {
      const result = playFixtureBattle(sim, k);
      expect(result.ended, `battle ${k}`).toBe(true);
      expect(result.cloneChecks.differ, `battle ${k}`).toBe(0);
      clones += result.cloneChecks.same;
      hashes.push(result.logHash);
    }
    expect(hashes).toEqual(provenance.gate.logHashes);
    expect(hashes).toEqual(SOURCE_LOG_HASHES);
    expect(clones).toBeGreaterThan(0);
  }, 60_000);

  it("a serialized clone continues exactly like the original", () => {
    const battle = new sim.Battle({ formatid: FORMAT, seed: [5, 6, 7, 8] });
    battle.setPlayer("p1", { name: "You", team: structuredClone(PLAYER) });
    battle.setPlayer("p2", { name: "Training", team: structuredClone(AI) });
    battle.makeChoices("team 1234", "team 1234");
    const clone = sim.State.deserializeBattle(JSON.stringify(sim.State.serializeBattle(battle)));
    clone.restart(() => {});
    const before = battle.log.length;
    battle.makeChoices("move 2 1, move 2 1", "move 2 1, move 2 2");
    clone.makeChoices("move 2 1, move 2 1", "move 2 1, move 2 2");
    expect(clone.log.slice(before).filter((line) => !line.startsWith("|t:|"))).toEqual(battle.log.slice(before).filter((line) => !line.startsWith("|t:|")));
  });

  it("splits secret lines per channel (PS/sim/battle.ts:33-56)", () => {
    const message = "|split|p2\n|-damage|p2a: Gyarados|150/180\n|-damage|p2a: Gyarados|84/100\n|turn|2";
    const channels = sim.extractChannelMessages(message, [1, 2]);
    expect(channels[1]).toEqual(["|-damage|p2a: Gyarados|84/100", "|turn|2"]);
    expect(channels[2]).toEqual(["|-damage|p2a: Gyarados|150/180", "|turn|2"]);
  });

  it("its types fit the Training contract (model/showdown-types.ts)", () => {
    expectTypeOf<ShowdownSet>().toExtend<PokemonSet>();
    expectTypeOf<ChoiceRequest>().toExtend<ShowdownRequest>();
  });
});
