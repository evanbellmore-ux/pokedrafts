import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * Iron Ball grounds a Levitate holder before the ability counts (pinned Showdown c23d2e94
 * sim/pokemon.ts isGrounded), so Ground moves hit it; the Champions engine skips that check. Level
 * 50, 0 Stat Points/EVs, 31 IVs, Serious nature, Singles, no crit. fix23/verify.ts checks 372 cases.
 */
function build(id: string, abilityId: string, itemId = "", runtime: BattleRuntime = championsRuntime): BattleBuild {
  return { ...createBuild(id, runtime), abilityId, itemId } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, runtime: BattleRuntime = championsRuntime) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const NOTE = "The target's Iron Ball grounds it, so its Levitate does not stop Ground moves.";

describe("Iron Ball on a Levitate holder", () => {
  const garchomp = build("garchomp", "roughskin");
  it("lets Ground moves hit it in Champions", () => {
    const grounded = row("earthquake", garchomp, build("eelektross", "levitate", "ironball"));
    expect(grounded).toMatchObject({ min: 170, max: 204 });
    expect(grounded.assumptions).toContain(NOTE);
    expect(grounded.description).not.toContain("Levitate");
    expect(row("earthquake", garchomp, build("hydreigon", "levitate", "ironball"))).toMatchObject({ min: 78, max: 93 });
    const moldBreaker = row("earthquake", build("excadrill", "moldbreaker"), build("eelektross", "levitate", "ironball"));
    expect(moldBreaker).toMatchObject({ min: 176, max: 210 });
    // With the Iron Ball working, ignoring Levitate changes nothing, so Mold Breaker is not listed.
    expect(moldBreaker.description).not.toContain("Mold Breaker");
    expect(row("earthquake", build("excadrill", "moldbreaker"), build("eelektross", "levitate")).description).toContain("Applied: Mold Breaker.");
    // Other moves are unchanged.
    expect(row("dragonclaw", garchomp, build("eelektross", "levitate", "ironball"))).toMatchObject({ min: 67, max: 81 });
  });

  it("keeps Levitate when the Iron Ball is absent or suppressed", () => {
    expect(row("earthquake", garchomp, build("eelektross", "levitate"))).toMatchObject({ min: 0, max: 0 });
    const magicRoom = row("earthquake", garchomp, build("eelektross", "levitate", "ironball"), { magicRoom: true });
    expect(magicRoom).toMatchObject({ min: 0, max: 0 });
    expect(magicRoom.assumptions).not.toContain(NOTE);
    // Gravity grounds it anyway, so no Iron Ball note.
    const gravity = row("earthquake", garchomp, build("eelektross", "levitate", "ironball"), { gravity: true });
    expect(gravity).toMatchObject({ min: 170, max: 204 });
    expect(gravity.assumptions).not.toContain(NOTE);
  });

  it("matches in the main games, whose engine already checks the Iron Ball", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const bronzong = row("earthquake", build("garchomp", "roughskin", "", sv), build("bronzong", "levitate", "ironball", sv), {}, sv);
    expect(bronzong).toMatchObject({ min: 126, max: 150 });
    expect(bronzong.assumptions).toContain(NOTE);
  });
});
