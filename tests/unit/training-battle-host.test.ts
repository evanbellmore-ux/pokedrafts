import { describe, expect, it } from "vitest";
import { BattleHost, choiceErrorText } from "@/app/(app)/training/sim/battle-host";
import { isMidTurn, normalizeRequest } from "@/app/(app)/training/sim/requests";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { AI_TEAM, PLAYER_TEAM, runtime } from "./training-sim-fixtures";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §7.1 / §13.3: the authoritative battle host.

const FORMAT = "gen9championsvgc2026regmc";
const own = toShowdownTeam(PLAYER_TEAM.members, runtime).sets.map((s) => s.set);
const opponent = toShowdownTeam(AI_TEAM.members, runtime).sets.map((s) => s.set);
const host = (seed: number[] | null = [1, 2, 3, 4], p1 = own) => new BattleHost({ formatid: FORMAT, seed, p1: { name: "You", team: p1 }, p2: { name: "Training", team: opponent } });

describe("BattleHost", () => {
  it("runs team preview, turns and the end, with one request id per new request", () => {
    const h = host();
    let drain = h.drain();
    expect(h.requestId).toBe(1);
    expect(drain.requests.p1 && "teamPreview" in drain.requests.p1).toBe(true);
    expect(drain.channel.p1.some((line) => line.startsWith("|poke|p2|Gyarados"))).toBe(true);
    expect(h.needsChoice("p1") && h.needsChoice("p2")).toBe(true);
    expect(h.choose("p2", "team 1234")).toEqual({ ok: true, committed: false });
    expect(h.needsChoice("p2")).toBe(false);
    expect(h.requestId).toBe(1);
    expect(h.choose("p1", "team 3412")).toEqual({ ok: true, committed: true });
    expect(h.requestId).toBe(2);
    drain = h.drain();
    expect(drain.turn).toBe(1);
    expect(drain.channel.p1).toContain("|turn|1");
    expect(drain.channel.p1.some((line) => line.startsWith("|switch|p1a: Whimsicott|"))).toBe(true);
    // Own HP exact on its own channel, the other side's as n/100 (pinned sim/battle.ts:33-56).
    expect(drain.channel.p2.some((line) => /^\|switch\|p1a: Whimsicott\|[^|]*\|100\/100$/.test(line))).toBe(true);
    expect(drain.channel.p2.some((line) => /^\|switch\|p2a: Gyarados\|[^|]*\|\d+\/\d+$/.test(line) && !line.endsWith("/100"))).toBe(true);
    const normalized = normalizeRequest(drain.requests.p1!, h.battle, h.requestId);
    expect(normalized.kind).toBe("move");
    expect(normalized.id).toBe(2);

    const choose = createChooser(3);
    let guard = 0, last = h.requestId;
    while (!h.drain().ended && guard++ < 300) {
      for (const side of ["p2", "p1"] as const) {
        if (!h.needsChoice(side)) continue;
        const result = h.choose(side, choose(side, h.request(side)));
        expect(result.ok, `${side} turn ${h.battle.turn}`).toBe(true);
      }
      if (!h.battle.ended) expect(h.requestId).toBeGreaterThan(last);
      last = h.requestId;
    }
    const end = h.drain();
    expect(end.ended).not.toBeNull();
    expect(end.requests).toEqual({ p1: null, p2: null });
    expect(h.inputLog()[0]).toMatch(/^>start /);
  }, 30_000);

  it("rejects a target on a spread move and two Megas with Showdown's text, keeping the request id", () => {
    const withTwoStones = own.map((set) => (set.name === "Garchomp" ? { ...set, item: "Garchompite" } : set));
    const h = host([5, 6, 7, 8], withTwoStones);
    h.choose("p2", "team 1234");
    h.choose("p1", "team 2413");
    h.drain();
    const id = h.requestId;
    const spread = h.choose("p1", "move 1 1, move 1 1");
    expect(spread).toEqual({ ok: false, error: "Can't move: You can't choose a target for Heat Wave", requestChanged: false });
    const megas = h.choose("p1", "move 1 mega, move 1 mega");
    expect(megas).toEqual({ ok: false, error: "Can't move: You can only mega-evolve once per battle", requestChanged: false });
    expect(h.requestId).toBe(id);
    expect(h.needsChoice("p1")).toBe(true);
    expect(choiceErrorText("|error|[Unavailable choice] Can't switch: The active Pokémon is trapped")).toBe("Can't switch: The active Pokémon is trapped");
  });

  it("checkChoice validates on a clone and leaves the live battle untouched", () => {
    const h = host();
    h.choose("p2", "team 1234");
    h.choose("p1", "team 1234");
    h.drain();
    const snapshot = h.snapshot();
    const logLength = h.battle.log.length;
    expect(h.checkChoice("p1", "move 2 1, move 1 1", snapshot)).toEqual({ ok: false, error: "Can't move: You can't choose a target for Heat Wave", requestChanged: false, request: null });
    expect(h.checkChoice("p1", "move 2 1, move 1", snapshot)).toEqual({ ok: true });
    expect(h.battle.log.length).toBe(logLength);
    expect(h.battle.p1.choice.actions.length).toBe(0);
    expect(h.snapshot()).toBe(snapshot);
  });

  it("asks for a mid-turn replacement after Parting Shot, then finishes the turn", () => {
    const h = host();
    h.choose("p2", "team 1234");
    h.choose("p1", "team 1234");
    h.drain();
    expect(h.choose("p2", "move 3, move 3")).toEqual({ ok: true, committed: false });
    expect(h.choose("p1", "move 3 2, move 4")).toEqual({ ok: true, committed: true });
    const mid = h.drain();
    expect(mid.midTurn).toBe(true);
    expect(mid.requests.p1 && "forceSwitch" in mid.requests.p1 ? mid.requests.p1.forceSwitch : null).toEqual([true, false]);
    expect(mid.requests.p2 && "wait" in mid.requests.p2).toBe(true);
    expect(normalizeRequest(mid.requests.p1!, h.battle, h.requestId)).toMatchObject({ kind: "switch", midTurn: true, forceSwitch: [true, false] });
    expect(h.needsChoice("p2")).toBe(false);
    expect(h.choose("p1", "switch 3").ok).toBe(true);
    const after = h.drain();
    expect(after.turn).toBe(2);
    expect(after.midTurn).toBe(false);
    expect(after.channel.p1.some((line) => line.startsWith("|switch|p1a: Whimsicott|"))).toBe(true);
  });

  it("tells end-of-turn replacements (queue empty) from mid-turn ones, though battle.midTurn is true at both", () => {
    expect(isMidTurn({ midTurn: true, queue: { list: [] } } as { midTurn: boolean })).toBe(false);
    expect(isMidTurn({ midTurn: true, queue: { list: [{ choice: "residual" }] } } as { midTurn: boolean })).toBe(true);
    expect(isMidTurn({ midTurn: false, queue: { list: [{ choice: "residual" }] } } as { midTurn: boolean })).toBe(false);
    let faintReplacements = 0;
    for (let seed = 1; seed <= 6 && !faintReplacements; seed++) {
      const h = host([seed, 2, 3, 4]);
      const choose = createChooser(seed);
      let guard = 0;
      while (!h.drain().ended && guard++ < 300) {
        const p1 = h.request("p1");
        if (p1 && "forceSwitch" in p1 && h.needsChoice("p1")) {
          const fainted = p1.forceSwitch.some((flag, i) => flag && p1.side.pokemon[i].condition.endsWith(" fnt"));
          if (fainted) {
            faintReplacements++;
            expect(h.battle.midTurn).toBe(true);
            expect(normalizeRequest(p1, h.battle, h.requestId)).toMatchObject({ kind: "switch", midTurn: false });
          }
        }
        for (const side of ["p2", "p1"] as const) if (h.needsChoice(side)) h.choose(side, choose(side, h.request(side)));
      }
    }
    expect(faintReplacements).toBeGreaterThan(0);
  }, 30_000);

  it("forfeits", () => {
    const h = host();
    h.choose("p2", "team 1234");
    h.choose("p1", "team 1234");
    h.drain();
    h.forfeit("p1");
    const drain = h.drain();
    expect(drain.ended).toEqual({ winner: "p2" });
    expect(h.needsChoice("p1")).toBe(false);
    expect(h.request("p1")).toBeNull();
  });

  it("uses a sodium seed from Web Crypto when none is given", () => {
    const h = host(null);
    expect(h.battle.prng.startingSeed).toMatch(/^sodium,[0-9a-f]{32}$/);
  });
});
